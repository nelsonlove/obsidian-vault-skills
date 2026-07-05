import { App, FuzzySuggestModal, Modal, Notice } from "obsidian";
import type VaultSkillsPlugin from "./main.js";
import { analyzeVault, collectNotes, markFrontmatter, type FieldConfig, type MarkInput } from "./exporter.js";

const fieldsOf = (p: VaultSkillsPlugin): FieldConfig => ({
  mode: p.settings.fieldMode,
  prefix: p.settings.fieldPrefix,
  key: p.settings.fieldKey,
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

  const patch = markFrontmatter({ type, parent } as MarkInput, fields);
  await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { Object.assign(fm, patch); });
  new Notice(`Vault Skills: marked "${file.basename}" as ${type}${parent ? ` · parent ${parent}` : ""}. Re-export to publish.`);
}
