import { Plugin, Notice, type TFile } from "obsidian";
import { runExport } from "./exporter.js";
import { expandTilde } from "./paths.js";
import { DEFAULT_SETTINGS, VaultSkillsSettingTab, fieldsOf, type VaultSkillsSettings } from "./settings.js";
import { cmdValidate, cmdTree, cmdMark, cmdRelease } from "./commands.js";
import { debounce, handleNoteChanged, type Debounced } from "./export-trigger.js";
import { UnixSocketListener } from "./mcp/socket-transport.js";
import { buildMcpServer } from "./mcp/server.js";
import { writeBridge, writeDiscovery, removeDiscovery } from "./mcp/discovery.js";
import { vaultSlug, socketPath, bridgeDestPath } from "./mcp/paths.js";
import { findClaudeBinary, claudeIsRegistered, claudeRegister } from "./mcp/claude-cli.js";
import { PreviewView, PREVIEW_VIEW_TYPE } from "./preview-view.js";

export default class VaultSkillsPlugin extends Plugin {
  declare settings: VaultSkillsSettings;
  private exporting = false;
  private requestExport: Debounced | null = null;
  private listener: UnixSocketListener | null = null;
  private slug = "";
  /** Transcluded-note paths from the last export — plain notes whose edits must also
   *  re-trigger export-on-save (their text is inlined into the compiled output). */
  private exportSources = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new VaultSkillsSettingTab(this.app, this));

    this.addRibbonIcon("sync", "Export vault skills to Claude Code", () => void this.export());
    this.addCommand({
      id: "export",
      name: "Export skills & agents to Claude Code",
      callback: () => void this.export(),
    });
    this.addCommand({ id: "validate", name: "Validate tree", callback: () => void cmdValidate(this) });
    this.addCommand({ id: "tree", name: "Show tree", callback: () => void cmdTree(this) });
    this.addCommand({ id: "mark", name: "Mark note as skill / agent / policy / command", callback: () => void cmdMark(this) });
    this.addCommand({ id: "release", name: "Export release to repo", callback: () => void cmdRelease(this) });

    this.registerView(PREVIEW_VIEW_TYPE, (leaf) => new PreviewView(leaf, this));
    this.addCommand({ id: "preview", name: "Preview compiled output", callback: () => void this.activatePreview() });

    // Optional: re-export when a skill/agent/policy note changes. The export is debounced
    // so a rename's burst of change events (the file rename plus the cascaded [[wikilink]]
    // rewrites in child notes) collapses into one export against the settled tree — exporting
    // mid-burst would validate half-rewritten parent links and drop children with spurious
    // "unresolved parent" errors. Relevance is read through the configured field mode so a
    // bare `type:` on an unrelated note doesn't false-positive. See export-trigger.ts.
    // Single gate for the export-on-save path: re-checks the setting at fire time (it may be
    // toggled off during the debounce window) and, if an export is already in flight, simply
    // re-arms itself so the change isn't lost — retrying every `wait` until the export settles
    // rather than dropping the event or unconditionally re-running past an unload/toggle-off.
    this.requestExport = debounce(() => {
      if (!this.settings.exportOnSave) return;
      if (this.exporting) { this.requestExport?.(); return; }
      void this.export(true);
    }, 750);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) =>
        handleNoteChanged(file, {
          isEnabled: () => this.settings.exportOnSave,
          fields: () => fieldsOf(this.settings),
          getFrontmatter: (f) => this.app.metadataCache.getFileCache(f as TFile)?.frontmatter as Record<string, unknown> | undefined,
          requestExport: () => this.requestExport?.(),
          isSource: (p) => this.exportSources.has(p),
        }),
      ),
    );

    void this.startServer();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async export(quiet = false): Promise<void> {
    // Concurrency guard: a change arriving mid-export isn't lost — the export-on-save trigger
    // re-arms itself while `exporting` is true (see onload), and manual invocations can just
    // be retried by the user.
    if (this.exporting) return;
    this.exporting = true;
    try {
      const outputDir = expandTilde(this.settings.outputDir);
      const summary = await runExport(this.app, {
        outputDir,
        pluginName: this.settings.pluginName,
        fields: fieldsOf(this.settings),
        assetsRoot: expandTilde(this.settings.assetsRoot),
      });
      this.exportSources = new Set(summary.sources);

      const issue = (label: string, items: string[]) =>
        items.length ? `\n${items.length} ${label}: ${items[0]}${items.length > 1 ? " …" : ""}` : "";
      const err = issue("error(s)", summary.errors);
      const warn = issue("warning(s)", summary.warnings);

      new Notice(
        `Vault Skills: exported ${summary.skills} skill(s) + ${summary.agents} agent(s)` +
          (summary.commands ? ` + ${summary.commands} command(s)` : "") +
          (summary.removed ? `, removed ${summary.removed}` : "") +
          err +
          warn +
          `\nRun /reload-plugins in Claude Code to load.`,
        quiet ? 4000 : summary.errors.length ? 12000 : 8000,
      );
      // Let open preview views re-diff against the fresh output (they show stale
      // statuses otherwise — the output dir emits no vault events).
      this.app.workspace.trigger("vault-skills:exported");
    } catch (e) {
      new Notice(`Vault Skills: export failed — ${e instanceof Error ? e.message : String(e)}`, 10000);
    } finally {
      this.exporting = false;
    }
  }

  private async activatePreview(): Promise<void> {
    // Reuse an existing preview leaf; otherwise open one in the main pane (the compiled
    // corpus is full-width content, not sidebar content).
    const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE);
    const leaf = existing[0] ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: PREVIEW_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async startServer(): Promise<void> {
    try {
      writeBridge();
      this.slug = vaultSlug(this.app.vault.getName());
      const sp = socketPath(this.slug);
      this.listener = new UnixSocketListener(sp, (transport) => {
        const server = buildMcpServer({ app: this.app, pluginVersion: this.manifest.version, getSettings: () => this.settings });
        void server.connect(transport).catch((e) => console.error("[vault-skills] server connect", e));
      });
      await this.listener.listen();
      const adapter = this.app.vault.adapter as { getBasePath?: () => string } | undefined;
      writeDiscovery(this.slug, {
        socket_path: sp,
        vault_path: adapter?.getBasePath?.() ?? "",
        vault_name: this.app.vault.getName(),
        plugin_version: this.manifest.version,
        started_at: new Date().toISOString(),
      });
      void this.autoRegister();
    } catch (e) {
      new Notice(`Vault Skills: MCP server failed to start — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async autoRegister(): Promise<void> {
    const bin = findClaudeBinary();
    if (!bin) return; // register manually: claude mcp add --scope user vault-skills -- node ~/.claude/vault-skills-mcp/bridge.mjs
    if (await claudeIsRegistered(bin)) return;
    await claudeRegister(bin, bridgeDestPath()).catch(() => { /* leave to manual registration */ });
  }

  async onunload(): Promise<void> {
    this.requestExport?.cancel(); // drop any pending export-on-save so it can't fire post-unload
    if (this.listener) await this.listener.close();
    if (this.slug) removeDiscovery(this.slug);
  }
}
