import { Plugin, Notice } from "obsidian";
import { runExport } from "./exporter.js";
import { expandTilde } from "./paths.js";
import { DEFAULT_SETTINGS, VaultSkillsSettingTab, type VaultSkillsSettings } from "./settings.js";

export default class VaultSkillsPlugin extends Plugin {
  declare settings: VaultSkillsSettings;
  private exporting = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new VaultSkillsSettingTab(this.app, this));

    this.addRibbonIcon("sync", "Export vault skills to Claude Code", () => void this.export());
    this.addCommand({
      id: "export",
      name: "Export skills & agents to Claude Code",
      callback: () => void this.export(),
    });

    // Optional: re-export when a skill/agent note changes.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.settings.exportOnSave) return;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm && (fm.type === "skill" || fm.type === "agent")) void this.export(true);
      }),
    );
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
}
