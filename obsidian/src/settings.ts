import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultSkillsPlugin from "./main.js";

export interface VaultSkillsSettings {
  outputDir: string;
  pluginName: string;
  exportOnSave: boolean;
  fieldMode: "prefix" | "nested";
  fieldPrefix: string;
  fieldKey: string;
}

export const DEFAULT_SETTINGS: VaultSkillsSettings = {
  outputDir: "~/.claude/skills/vault-skills",
  pluginName: "vault-skills",
  exportOnSave: false,
  fieldMode: "prefix",
  fieldPrefix: "", // blank prefix = bare top-level fields (type, parent, …)
  fieldKey: "vault-skills",
};

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
