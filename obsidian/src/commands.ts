import { App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type VaultSkillsPlugin from "./main.js";
import { analyzeVault, applyMark, collectNotes, markFrontmatter, readPluginVersion, runExport, type DetectConfig, type MarkInput } from "./exporter.js";
import { expandTilde } from "./paths.js";

const fieldsOf = (p: VaultSkillsPlugin): DetectConfig => ({
  mode: p.settings.fieldMode,
  prefix: p.settings.fieldPrefix,
  key: p.settings.fieldKey,
  typeSource: p.settings.typeSource,
  tagPrefix: p.settings.tagPrefix,
});
const base = (p: string): string => (p.split("/").pop() ?? "").replace(/\.md$/, "");

/** Simple scrollable text modal for validate/tree output. */
class TextModal extends Modal {
  constructor(app: App, private titleText: string, private lines: string[]) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("pre", { text: this.lines.join("\n") });
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Single-line text prompt (resolves undefined if dismissed). */
function promptText(app: App, title: string, initial: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let submitted: string | undefined;
    class P extends Modal {
      onOpen(): void {
        this.titleEl.setText(title);
        let value = initial;
        new Setting(this.contentEl).addText((t) => {
          t.setValue(initial).onChange((v) => { value = v; });
          t.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { submitted = value.trim(); this.close(); }
          });
          t.inputEl.focus();
          t.inputEl.select();
        });
        new Setting(this.contentEl).addButton((b) =>
          b.setButtonText("OK").setCta().onClick(() => { submitted = value.trim(); this.close(); }),
        );
      }
      onClose(): void { this.contentEl.empty(); resolve(submitted); }
    }
    new P(app).open();
  });
}

/** Promise-wrapped fuzzy picker (resolves undefined if dismissed). */
function pick<T>(app: App, items: T[], label: (t: T) => string): Promise<T | undefined> {
  return new Promise((resolve) => {
    let chosen: T | undefined;
    class S extends FuzzySuggestModal<T> {
      getItems(): T[] { return items; }
      getItemText(t: T): string { return label(t); }
      onChooseItem(t: T): void { chosen = t; resolve(t); }
      onClose(): void { this.contentEl.empty(); resolve(chosen); }
    }
    new S(app).open();
  });
}

export async function cmdValidate(plugin: VaultSkillsPlugin): Promise<void> {
  const a = await analyzeVault(plugin.app, fieldsOf(plugin), plugin.settings.pluginName);
  const lines = [
    `${a.counts.agents} agents · ${a.counts.skills} skills · ${a.counts.policies} policies`,
    "",
    ...(a.errors.length ? ["Errors:", ...a.errors.map((e) => "  ✖ " + e)] : ["No errors ✓"]),
    ...(a.warnings.length ? ["", "Warnings:", ...a.warnings.map((w) => "  ⚠ " + w)] : []),
  ];
  new TextModal(plugin.app, "Vault Skills — validate", lines).open();
}

export async function cmdTree(plugin: VaultSkillsPlugin): Promise<void> {
  const a = await analyzeVault(plugin.app, fieldsOf(plugin), plugin.settings.pluginName);
  const byName = new Map(a.tree.map((n) => [n.name, n]));
  const lines: string[] = [];
  const walk = (name: string, depth: number): void => {
    const n = byName.get(name);
    if (!n) return;
    lines.push("  ".repeat(depth) + "▸ " + n.name + (n.skills.length ? `  ⟨${n.skills.join(", ")}⟩` : ""));
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const r of a.tree.filter((n) => n.parent === null)) walk(r.name, 0);
  if (!lines.length) lines.push("(no skills or agents found)");
  new TextModal(plugin.app, "Vault Skills — tree", lines).open();
}

export async function cmdMark(plugin: VaultSkillsPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) { new Notice("Vault Skills: no active note."); return; }
  const fields = fieldsOf(plugin);

  const type = await pick(plugin.app, ["agent", "skill", "policy"] as const, (t) => t);
  if (!type) return;

  const notes = await collectNotes(plugin.app, fields);
  const agents = notes.filter((n) => n.frontmatter.type === "agent").map((n) => base(n.path)).sort();
  const NONE = "— none (attach to root) —";
  const choice = await pick(plugin.app, [NONE, ...agents], (t) => t);
  if (choice === undefined) return;
  const parent = choice === NONE ? undefined : choice;

  const result = markFrontmatter({ type, parent } as MarkInput, fields);
  await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { applyMark(fm, result); });
  new Notice(`Vault Skills: marked "${file.basename}" as ${type}${parent ? ` · parent ${parent}` : ""}. Re-export to publish.`);
}

/** Suggest the next patch version from an existing semver-ish string. */
export function bumpPatch(version: string | undefined): string {
  const m = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "0.1.0";
}

export async function cmdRelease(plugin: VaultSkillsPlugin): Promise<void> {
  const releaseDir = expandTilde(plugin.settings.releaseDir);
  if (!releaseDir) {
    new Notice("Vault Skills: set the release repo directory in settings first.");
    return;
  }
  const version = await promptText(plugin.app, "Release version", bumpPatch(readPluginVersion(releaseDir)));
  if (!version) return;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    new Notice(`Vault Skills: "${version}" is not a semver version (X.Y.Z) — release aborted.`);
    return;
  }
  try {
    const summary = await runExport(plugin.app, {
      outputDir: releaseDir,
      pluginName: plugin.settings.pluginName,
      fields: fieldsOf(plugin),
      assetsRoot: expandTilde(plugin.settings.assetsRoot),
      version,
    });
    const issues = summary.errors.length ? ` · ${summary.errors.length} error(s): ${summary.errors[0]}` : "";
    new Notice(
      `Vault Skills: packaged ${version} → ${releaseDir}\n` +
        `${summary.skills} skill(s) + ${summary.agents} agent(s) + ${summary.assets} supporting file(s)${issues}\n` +
        `Commit & tag in the repo to publish.`,
      summary.errors.length ? 12000 : 8000,
    );
  } catch (e) {
    new Notice(`Vault Skills: release export failed — ${e instanceof Error ? e.message : String(e)}`, 10000);
  }
}
