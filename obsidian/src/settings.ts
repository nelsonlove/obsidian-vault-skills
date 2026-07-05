import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultSkillsPlugin from "./main.js";

export interface VaultSkillsSettings {
  outputDir: string;
  pluginName: string;
  manageSymlink: boolean;
  exportOnSave: boolean;
}

export const DEFAULT_SETTINGS: VaultSkillsSettings = {
  outputDir: "~/repos/vault-skills/claude-plugin",
  pluginName: "vault-skills",
  manageSymlink: true,
  exportOnSave: false,
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
      .setDesc("Claude Code plugin name — also the command namespace and the ~/.claude/skills symlink name.")
      .addText((t) =>
        t.setValue(this.plugin.settings.pluginName).onChange(async (v) => {
          this.plugin.settings.pluginName = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Manage ~/.claude symlink")
      .setDesc("Ensure ~/.claude/skills/<name> → the output directory, so Claude Code loads it in place.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.manageSymlink).onChange(async (v) => {
          this.plugin.settings.manageSymlink = v;
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
  }
}
