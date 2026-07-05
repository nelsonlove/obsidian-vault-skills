import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultSkillsPlugin from "./main.js";

export interface VaultSkillsSettings {
  outputDir: string;
  pluginName: string;
  exportOnSave: boolean;
  fieldMode: "bare" | "prefix" | "nested";
  fieldPrefix: string;
  fieldKey: string;
}

export const DEFAULT_SETTINGS: VaultSkillsSettings = {
  outputDir: "~/.claude/skills/vault-skills",
  pluginName: "vault-skills",
  exportOnSave: false,
  fieldMode: "bare",
  fieldPrefix: "vs-",
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
      .setDesc("How vault-skills fields are namespaced, to avoid colliding with existing frontmatter (e.g. your own `description`/`type`). bare: type/parent/… · prefix: <prefix>type/… · nested: under one key.")
      .addDropdown((d) =>
        d.addOptions({ bare: "bare", prefix: "prefix", nested: "nested" })
          .setValue(this.plugin.settings.fieldMode)
          .onChange(async (v) => {
            this.plugin.settings.fieldMode = v as "bare" | "prefix" | "nested";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Field prefix")
      .setDesc('For "prefix" mode, e.g. "vs-" → vs-type, vs-parent. Keeps fields top-level, so the parent wikilink still gets backlinks/graph edges.')
      .addText((t) =>
        t.setValue(this.plugin.settings.fieldPrefix).onChange(async (v) => {
          this.plugin.settings.fieldPrefix = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Field key")
      .setDesc('For "nested" mode, e.g. "vault-skills" → all fields under that key. Note: a nested parent wikilink may not get Obsidian backlinks/graph edges, and the Properties UI won\'t edit nested objects.')
      .addText((t) =>
        t.setValue(this.plugin.settings.fieldKey).onChange(async (v) => {
          this.plugin.settings.fieldKey = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
