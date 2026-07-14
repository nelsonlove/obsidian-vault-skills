import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultSkillsPlugin from "./main.js";
import type { DetectConfig } from "./exporter.js";

export interface VaultSkillsSettings {
  outputDir: string;
  pluginName: string;
  exportOnSave: boolean;
  typeSource: "frontmatter" | "tags";
  tagPrefix: string;
  fieldMode: "prefix" | "nested";
  fieldPrefix: string;
  fieldKey: string;
  assetsRoot: string;
  releaseDir: string;
}

export const DEFAULT_SETTINGS: VaultSkillsSettings = {
  outputDir: "~/.claude/skills/vault-skills",
  pluginName: "vault-skills",
  exportOnSave: false,
  typeSource: "frontmatter", // read the kind from the `type` field (default; back-compatible)
  tagPrefix: "agent/", // tags mode: #agent/skill, #agent/agent, #agent/policy
  fieldMode: "prefix",
  fieldPrefix: "", // blank prefix = bare top-level fields (type, parent, …)
  fieldKey: "vault-skills",
  assetsRoot: "", // blank = no supporting-files tree
  releaseDir: "", // blank = release export disabled
};

/** The one place that maps settings → the exporter's detection + field config. */
export function detectConfigFromSettings(s: VaultSkillsSettings): DetectConfig {
  return {
    mode: s.fieldMode,
    prefix: s.fieldPrefix,
    key: s.fieldKey,
    typeSource: s.typeSource,
    tagPrefix: s.tagPrefix,
  };
}

export class VaultSkillsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VaultSkillsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Output plugin directory")
      .setDesc("Where the generated Claude Code plugin (skills/ + agents/) is written. ~ is expanded.")
      .addText((t) =>
        t.setValue(this.plugin.settings.outputDir).onChange(async (v) => {
          this.plugin.settings.outputDir = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Plugin name")
      .setDesc("Claude Code plugin name — also the command/subagent namespace.")
      .addText((t) =>
        t.setValue(this.plugin.settings.pluginName).onChange(async (v) => {
          this.plugin.settings.pluginName = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Export on save")
      .setDesc("Re-export automatically when a skill/agent note changes. You still run /reload-plugins in Claude Code.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exportOnSave).onChange(async (v) => {
          this.plugin.settings.exportOnSave = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Supporting-files tree")
      .setDesc("Root of a filesystem tree that parallels the vault (e.g. ~/Documents in a Johnny Decimal setup). A skill note at <dir>/<name>.md bundles every file under <root>/<dir>/<name>/ into its generated skill, next to SKILL.md. iCloud-evicted files are downloaded first. Leave blank to disable. ~ is expanded.")
      .addText((t) =>
        t.setValue(this.plugin.settings.assetsRoot).onChange(async (v) => {
          this.plugin.settings.assetsRoot = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Release repo directory")
      .setDesc("A git checkout that the 'Export release to repo' command targets — it writes the full plugin there and stamps the version you choose into .claude-plugin/plugin.json. Commit/tag yourself. Leave blank to disable. ~ is expanded.")
      .addText((t) =>
        t.setValue(this.plugin.settings.releaseDir).onChange(async (v) => {
          this.plugin.settings.releaseDir = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Type source")
      .setDesc("How a note declares its kind (skill / agent / policy). 'frontmatter type' reads the type field; 'tags' reads a tag instead. Either way, parent/description and the other fields stay in frontmatter.")
      .addDropdown((d) =>
        d.addOptions({ frontmatter: "frontmatter type", tags: "tags" })
          .setValue(this.plugin.settings.typeSource)
          .onChange(async (v) => {
            this.plugin.settings.typeSource = v as "frontmatter" | "tags";
            await this.plugin.saveSettings();
            this.display(); // re-render so the Tag prefix field shows/hides
          }),
      );

    if (this.plugin.settings.typeSource === "tags") {
      const p = this.plugin.settings.tagPrefix;
      new Setting(containerEl)
        .setName("Tag prefix")
        .setDesc(`Kind tags are #${p}skill, #${p}agent, #${p}policy (read from frontmatter tags, case-insensitive). Leave blank for bare #skill / #agent / #policy — but those collide with everyday tags, so a namespaced prefix is safer.`)
        .addText((t) =>
          t.setValue(this.plugin.settings.tagPrefix).onChange(async (v) => {
            this.plugin.settings.tagPrefix = v.trim();
            await this.plugin.saveSettings();
          }),
        );
    }

    new Setting(containerEl)
      .setName("Frontmatter field mode")
      .setDesc("How vault-skills fields are namespaced, to avoid colliding with existing frontmatter. prefix: <prefix>type/… (leave the prefix blank for bare top-level fields). nested: all fields under one key.")
      .addDropdown((d) =>
        d.addOptions({ prefix: "prefix", nested: "nested" })
          .setValue(this.plugin.settings.fieldMode)
          .onChange(async (v) => {
            this.plugin.settings.fieldMode = v as "prefix" | "nested";
            await this.plugin.saveSettings();
            this.display(); // re-render so the relevant field (prefix vs key) shows
          }),
      );

    if (this.plugin.settings.fieldMode === "prefix") {
      new Setting(containerEl)
        .setName("Field prefix")
        .setDesc('Prefixes each field, e.g. "vs-" → vs-type, vs-parent. Leave blank for bare top-level fields (type, parent, …). Keeps fields top-level, so the parent wikilink keeps backlinks/graph edges.')
        .addText((t) =>
          t.setValue(this.plugin.settings.fieldPrefix).onChange(async (v) => {
            this.plugin.settings.fieldPrefix = v;
            await this.plugin.saveSettings();
          }),
        );
    } else {
      new Setting(containerEl)
        .setName("Field key")
        .setDesc('Nests all fields under this key, e.g. "vault-skills". Note: a nested parent wikilink may not get Obsidian backlinks/graph edges, and the Properties UI won\'t edit nested objects.')
        .addText((t) =>
          t.setValue(this.plugin.settings.fieldKey).onChange(async (v) => {
            this.plugin.settings.fieldKey = v;
            await this.plugin.saveSettings();
          }),
        );
    }
  }
}
