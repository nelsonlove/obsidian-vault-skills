import { Plugin, Notice, type TFile } from "obsidian";
import { runExport } from "./exporter.js";
import { expandTilde } from "./paths.js";
import { DEFAULT_SETTINGS, VaultSkillsSettingTab, type VaultSkillsSettings } from "./settings.js";
import { cmdValidate, cmdTree, cmdMark, cmdRelease } from "./commands.js";
import { debounce, handleNoteChanged } from "./export-trigger.js";
import { UnixSocketListener } from "./mcp/socket-transport.js";
import { buildMcpServer } from "./mcp/server.js";
import { writeBridge, writeDiscovery, removeDiscovery } from "./mcp/discovery.js";
import { vaultSlug, socketPath, bridgeDestPath } from "./mcp/paths.js";
import { findClaudeBinary, claudeIsRegistered, claudeRegister } from "./mcp/claude-cli.js";

export default class VaultSkillsPlugin extends Plugin {
  declare settings: VaultSkillsSettings;
  private exporting = false;
  private listener: UnixSocketListener | null = null;
  private slug = "";

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
    this.addCommand({ id: "mark", name: "Mark note as skill / agent / policy", callback: () => void cmdMark(this) });
    this.addCommand({ id: "release", name: "Export release to repo", callback: () => void cmdRelease(this) });

    // Optional: re-export when a skill/agent/policy note changes. The export is debounced
    // so a rename's burst of change events (the file rename plus the cascaded [[wikilink]]
    // rewrites in child notes) collapses into one export against the settled tree — exporting
    // mid-burst would validate half-rewritten parent links and drop children with spurious
    // "unresolved parent" errors. Relevance is read through the configured field mode so a
    // bare `type:` on an unrelated note doesn't false-positive. See export-trigger.ts.
    // Re-check the setting at fire time: it may be toggled off during the debounce window.
    const requestExport = debounce(() => { if (this.settings.exportOnSave) void this.export(true); }, 750);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) =>
        handleNoteChanged(file, {
          isEnabled: () => this.settings.exportOnSave,
          fields: () => ({ mode: this.settings.fieldMode, prefix: this.settings.fieldPrefix, key: this.settings.fieldKey }),
          getFrontmatter: (f) => this.app.metadataCache.getFileCache(f as TFile)?.frontmatter as Record<string, unknown> | undefined,
          requestExport,
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
    if (this.exporting) return;
    this.exporting = true;
    try {
      const outputDir = expandTilde(this.settings.outputDir);
      const summary = await runExport(this.app, {
        outputDir,
        pluginName: this.settings.pluginName,
        fields: { mode: this.settings.fieldMode, prefix: this.settings.fieldPrefix, key: this.settings.fieldKey },
        assetsRoot: expandTilde(this.settings.assetsRoot),
      });

      const issue = (label: string, items: string[]) =>
        items.length ? `\n${items.length} ${label}: ${items[0]}${items.length > 1 ? " …" : ""}` : "";
      const err = issue("error(s)", summary.errors);
      const warn = issue("warning(s)", summary.warnings);

      new Notice(
        `Vault Skills: exported ${summary.skills} skill(s) + ${summary.agents} agent(s)` +
          (summary.removed ? `, removed ${summary.removed}` : "") +
          err +
          warn +
          `\nRun /reload-plugins in Claude Code to load.`,
        quiet ? 4000 : summary.errors.length ? 12000 : 8000,
      );
    } catch (e) {
      new Notice(`Vault Skills: export failed — ${e instanceof Error ? e.message : String(e)}`, 10000);
    } finally {
      this.exporting = false;
    }
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
    if (this.listener) await this.listener.close();
    if (this.slug) removeDiscovery(this.slug);
  }
}
