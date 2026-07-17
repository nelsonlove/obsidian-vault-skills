// Preview view — the compiled Claude Code output, browsable before export.
//
// Left: the agent/skill tree plus flat groups (commands, policies, static, removed), each
// node badged with its diff status against the current export. Right: the selected entry
// as Claude Code sees it — the listing line (name + description), the full compiled file,
// and, when modified, the currently exported version side by side. Always a fresh
// `previewVault` render; no persisted state. See docs/preview-design.md.

import { ItemView, type WorkspaceLeaf, type TFile } from "obsidian";
import type VaultSkillsPlugin from "./main.js";
import { previewVault, type PreviewEntry, type PreviewResult } from "./exporter.js";
import { fieldsOf } from "./settings.js";
import { expandTilde } from "./paths.js";
import { debounce, handleNoteChanged, type Debounced } from "./export-trigger.js";

export const PREVIEW_VIEW_TYPE = "vault-skills-preview";

const BADGE: Record<string, string> = { added: "+", modified: "±", unchanged: "·", removed: "✕" };
const BADGE_COLOR: Record<string, string> = {
  added: "var(--color-green)",
  modified: "var(--color-orange)",
  unchanged: "var(--text-faint)",
  removed: "var(--color-red)",
};

type Tab = "listing" | "compiled" | "diff";

export class PreviewView extends ItemView {
  private result: PreviewResult | null = null;
  private error: string | null = null;
  private selected: string | null = null; // entry relOut, "policy:<path>", or "removed:<relOut>"
  private tab: Tab = "listing";
  private refreshDebounced: Debounced | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: VaultSkillsPlugin) {
    super(leaf);
  }

  getViewType(): string { return PREVIEW_VIEW_TYPE; }
  getDisplayText(): string { return "Vault skills preview"; }
  getIcon(): string { return "eye"; }

  async onOpen(): Promise<void> {
    // Auto-refresh while open: same relevance check as export-on-save, debounced so a
    // rename's burst of cache events collapses into one re-render of the settled tree.
    this.refreshDebounced = debounce(() => void this.refresh(), 1000);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) =>
        handleNoteChanged(file, {
          isEnabled: () => true,
          fields: () => fieldsOf(this.plugin.settings),
          getFrontmatter: (f) => this.app.metadataCache.getFileCache(f as TFile)?.frontmatter as Record<string, unknown> | undefined,
          requestExport: () => this.refreshDebounced?.(),
        }),
      ),
    );
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.refreshDebounced?.cancel();
    this.contentEl.empty();
  }

  private async refresh(): Promise<void> {
    try {
      const s = this.plugin.settings;
      this.result = await previewVault(this.app, {
        outputDir: expandTilde(s.outputDir),
        pluginName: s.pluginName,
        fields: fieldsOf(s),
      });
      this.error = null;
      // Keep the selection when the entry still exists; else clear it.
      if (this.selected && !this.selectionExists(this.selected)) this.selected = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.render();
  }

  private selectionExists(sel: string): boolean {
    const r = this.result;
    if (!r) return false;
    if (sel.startsWith("policy:")) return r.policies.some((p) => `policy:${p.path}` === sel);
    if (sel.startsWith("removed:")) return r.removed.some((p) => `removed:${p}` === sel);
    return r.entries.some((e) => e.relOut === sel);
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.height = "100%";

    this.renderHeader(root);
    if (this.error) {
      root.createEl("div", { text: `Preview failed: ${this.error}` }).style.color = "var(--color-red)";
      return;
    }
    const r = this.result;
    if (!r) { root.createEl("div", { text: "Loading…" }); return; }

    if (r.errors.length) {
      const banner = root.createDiv();
      banner.style.cssText = "color: var(--color-red); padding: 4px 8px; border: 1px solid var(--color-red); border-radius: 4px; margin: 4px 0;";
      banner.createEl("strong", { text: `${r.errors.length} transform error(s)` });
      for (const e of r.errors) banner.createEl("div", { text: `✖ ${e}` });
    }

    const body = root.createDiv();
    body.style.cssText = "display: flex; flex: 1; min-height: 0; gap: 8px;";
    const nav = body.createDiv();
    nav.style.cssText = "width: 280px; overflow-y: auto; border-right: 1px solid var(--background-modifier-border); padding-right: 8px; flex-shrink: 0;";
    const detail = body.createDiv();
    detail.style.cssText = "flex: 1; overflow-y: auto; min-width: 0;";

    this.renderNav(nav, r);
    this.renderDetail(detail, r);
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv();
    header.style.cssText = "display: flex; align-items: center; gap: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 6px;";
    const btn = header.createEl("button", { text: "Refresh" });
    btn.addEventListener("click", () => void this.refresh());
    const r = this.result;
    if (r) {
      const d = r.diff;
      header.createEl("span", {
        text: `${d.added} added · ${d.modified} modified · ${d.unchanged} unchanged · ${d.removed} removed`,
      }).style.color = "var(--text-muted)";
      header.createEl("span", { text: `→ ${r.outputDir}` }).style.cssText = "color: var(--text-faint); font-size: var(--font-ui-smaller);";
    }
  }

  private navLine(parent: HTMLElement, opts: { sel: string; badge: string; label: string; depth: number; muted?: boolean }): void {
    const line = parent.createDiv();
    line.style.cssText = `padding: 1px 4px 1px ${4 + opts.depth * 14}px; cursor: pointer; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
    if (this.selected === opts.sel) line.style.background = "var(--background-modifier-hover)";
    const badge = line.createEl("span", { text: opts.badge + " " });
    badge.style.color = BADGE_COLOR[Object.entries(BADGE).find(([, v]) => v === opts.badge)?.[0] ?? "unchanged"];
    badge.style.fontFamily = "var(--font-monospace)";
    line.createEl("span", { text: opts.label }).style.color = opts.muted ? "var(--text-muted)" : "var(--text-normal)";
    line.addEventListener("click", () => {
      this.selected = opts.sel;
      this.tab = "listing";
      this.render();
    });
  }

  private group(nav: HTMLElement, title: string): HTMLElement {
    const h = nav.createEl("div", { text: title });
    h.style.cssText = "margin-top: 10px; font-size: var(--font-ui-smaller); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint);";
    return nav.createDiv();
  }

  private renderNav(nav: HTMLElement, r: PreviewResult): void {
    const byRelOut = new Map(r.entries.map((e) => [e.relOut, e]));
    const entryFor = (name: string, kind: "agent" | "skill"): PreviewEntry | undefined =>
      byRelOut.get(kind === "agent" ? `agents/${name}.md` : `skills/${name}/SKILL.md`);
    const byName = new Map(r.tree.map((n) => [n.name, n]));

    const treeBox = this.group(nav, "Tree");
    const walk = (name: string, depth: number): void => {
      const n = byName.get(name);
      if (!n) return;
      const e = entryFor(n.name, "agent");
      this.navLine(treeBox, { sel: e?.relOut ?? "", badge: BADGE[e?.status ?? "unchanged"], label: `▸ ${n.name}${n.crosscutting ? " ⤫" : ""}`, depth });
      for (const s of n.skills) {
        const se = entryFor(s, "skill");
        this.navLine(treeBox, { sel: se?.relOut ?? "", badge: BADGE[se?.status ?? "unchanged"], label: s, depth: depth + 1, muted: false });
      }
      for (const c of n.children) walk(c, depth + 1);
    };
    for (const rootNode of r.tree.filter((n) => n.parent === null)) walk(rootNode.name, 0);

    const commands = r.entries.filter((e) => e.kind === "command");
    if (commands.length) {
      const box = this.group(nav, "Commands");
      for (const c of commands) this.navLine(box, { sel: c.relOut, badge: BADGE[c.status], label: `/${c.name ?? c.relOut}`, depth: 0 });
    }

    if (r.policies.length) {
      const box = this.group(nav, "Policies");
      for (const p of r.policies) {
        this.navLine(box, { sel: `policy:${p.path}`, badge: p.hard ? "‼" : "§", label: p.title, depth: 0 });
      }
    }

    const statics = r.entries.filter((e) => e.from === "(static)");
    if (statics.length) {
      const box = this.group(nav, "Static");
      for (const s of statics) this.navLine(box, { sel: s.relOut, badge: BADGE[s.status], label: s.relOut, depth: 0, muted: true });
    }

    if (r.removed.length) {
      const box = this.group(nav, "Removed on next export");
      for (const rel of r.removed) this.navLine(box, { sel: `removed:${rel}`, badge: BADGE.removed, label: rel, depth: 0, muted: true });
    }
  }

  private pre(parent: HTMLElement, text: string): void {
    const pre = parent.createEl("pre", { text });
    pre.style.cssText = "white-space: pre-wrap; word-break: break-word; user-select: text; font-size: var(--font-smaller); background: var(--background-secondary); padding: 8px; border-radius: 4px;";
  }

  private sourceLink(parent: HTMLElement, from: string): void {
    if (from.startsWith("(")) { parent.createEl("span", { text: from }).style.color = "var(--text-faint)"; return; }
    const a = parent.createEl("a", { text: from });
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      void this.app.workspace.openLinkText(from, "", false);
    });
  }

  private renderDetail(detail: HTMLElement, r: PreviewResult): void {
    const sel = this.selected;
    if (!sel) {
      detail.createEl("div", { text: "Select a node to preview its compiled output." }).style.color = "var(--text-muted)";
      return;
    }

    if (sel.startsWith("policy:")) {
      const p = r.policies.find((x) => `policy:${x.path}` === sel);
      if (!p) return;
      detail.createEl("h3", { text: p.title + (p.hard ? " (hard)" : "") });
      const meta = detail.createDiv();
      meta.createEl("span", { text: "source: " });
      this.sourceLink(meta, p.path);
      detail.createEl("p", {
        text: p.agents.length
          ? `Injected into ${p.agents.length} agent file(s):`
          : "Not injected into any agent file (parent agent has no valid subtree).",
      });
      const ul = detail.createEl("ul");
      for (const a of p.agents) {
        const li = ul.createEl("li");
        const link = li.createEl("a", { text: `agents/${a}.md` });
        link.addEventListener("click", (ev) => { ev.preventDefault(); this.selected = `agents/${a}.md`; this.tab = "compiled"; this.render(); });
      }
      return;
    }

    if (sel.startsWith("removed:")) {
      const rel = sel.slice("removed:".length);
      detail.createEl("h3", { text: rel });
      detail.createEl("p", { text: "Present in the current export but no longer generated — the next export deletes it." })
        .style.color = "var(--color-red)";
      return;
    }

    const e = r.entries.find((x) => x.relOut === sel);
    if (!e) return;

    detail.createEl("h3", { text: e.name ?? e.relOut });
    const meta = detail.createDiv();
    meta.style.cssText = "color: var(--text-muted); font-size: var(--font-ui-smaller); margin-bottom: 6px;";
    meta.createEl("span", { text: `${e.kind} · ${e.relOut} · ${e.bytes} bytes · ${e.status} · source: ` });
    this.sourceLink(meta, e.from);

    const tabs: Tab[] = e.status === "modified" ? ["listing", "compiled", "diff"] : ["listing", "compiled"];
    if (!tabs.includes(this.tab)) this.tab = "listing";
    const bar = detail.createDiv();
    bar.style.cssText = "display: flex; gap: 4px; margin-bottom: 6px;";
    for (const t of tabs) {
      const b = bar.createEl("button", { text: t });
      if (t === this.tab) b.style.cssText = "background: var(--interactive-accent); color: var(--text-on-accent);";
      b.addEventListener("click", () => { this.tab = t; this.render(); });
    }

    if (this.tab === "listing") {
      // The line Claude Code's skill/agent lists actually show: name + description.
      const box = detail.createDiv();
      box.style.cssText = "background: var(--background-secondary); padding: 8px; border-radius: 4px;";
      if (e.name) box.createEl("div", { text: e.name }).style.fontWeight = "600";
      box.createEl("div", { text: e.description ?? "(no listing line — static file)" });
    } else if (this.tab === "compiled") {
      this.pre(detail, e.content);
    } else {
      detail.createEl("div", { text: "Currently exported:" }).style.fontWeight = "600";
      this.pre(detail, e.cachedContent ?? "");
      detail.createEl("div", { text: "After export:" }).style.fontWeight = "600";
      this.pre(detail, e.content);
    }
  }
}
