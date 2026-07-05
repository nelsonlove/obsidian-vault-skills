import type { App } from "obsidian";
import * as fs from "node:fs";
import * as path from "node:path";
import { transformAll, type NoteInput } from "./transform.js";
import { STATIC_FILES } from "./static-skills.js";

const MANIFEST_NAME = ".vault-skills-manifest.json";

/** How the vault-skills fields are namespaced in a note's frontmatter. */
export interface FieldConfig {
  mode: "bare" | "prefix" | "nested";
  prefix: string; // e.g. "vs-" → vs-type, vs-parent (prefix mode)
  key: string;    // e.g. "vault-skills" → nested object (nested mode)
}

export const DEFAULT_FIELDS: FieldConfig = { mode: "bare", prefix: "vs-", key: "vault-skills" };

export interface ExportOptions {
  outputDir: string;
  pluginName: string;
  pluginDescription?: string;
  fields?: FieldConfig;
}

export interface ExportSummary {
  skills: number;
  agents: number;
  removed: number;
  warnings: string[];
  errors: string[];
  outputDir: string;
}

/** Strip a single leading YAML frontmatter block. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^\s+/, "");
}

/** Extract link targets from a frontmatter `parent` value (string or list). */
function parentLinkpaths(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return arr.map(String)
    .map((s) => s.replace(/\[\[|\]\]/g, "").split("|")[0].split("#")[0].trim())
    .filter(Boolean);
}

/** Resolve each parent wikilink to a target note path; unresolved links get a marker
 *  that won't match any node (so the transform reports them as broken edges). */
function resolveParents(app: App, sourcePath: string, v: unknown): string[] {
  return parentLinkpaths(v).map((lp) => {
    const dest = app.metadataCache.getFirstLinkpathDest(lp, sourcePath);
    return dest ? dest.path : `⟂unresolved:${lp}`;
  });
}

// The vault-skills fields the transform reads (parent is handled separately, resolved to paths).
const VS_FIELDS = ["type", "root", "name", "id", "label", "description", "version", "tools", "model"];

/** Extract a bare view of the vault-skills fields (+ the raw parent value) per the field mode,
 *  so the pure transform stays namespace-agnostic. */
function fieldView(fm: Record<string, unknown>, cfg: FieldConfig): { view: Record<string, unknown>; parent: unknown } {
  if (cfg.mode === "prefix") {
    const view: Record<string, unknown> = {};
    for (const f of VS_FIELDS) view[f] = fm[cfg.prefix + f];
    return { view, parent: fm[cfg.prefix + "parent"] };
  }
  if (cfg.mode === "nested") {
    const nested = (fm[cfg.key] && typeof fm[cfg.key] === "object" ? fm[cfg.key] : {}) as Record<string, unknown>;
    return { view: nested, parent: nested.parent };
  }
  return { view: fm, parent: fm.parent }; // bare
}

/** Collect every note whose (namespaced) frontmatter marks it a skill/agent/policy. */
export async function collectNotes(app: App, fields: FieldConfig = DEFAULT_FIELDS): Promise<NoteInput[]> {
  const notes: NoteInput[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) continue;
    const { view, parent } = fieldView(fm, fields);
    if (view.type !== "skill" && view.type !== "agent" && view.type !== "policy") continue;
    const raw = await app.vault.cachedRead(file);
    notes.push({
      path: file.path,
      frontmatter: view,
      body: stripFrontmatter(raw),
      parentPaths: resolveParents(app, file.path, parent),
    });
  }
  return notes;
}

export async function runExport(app: App, opts: ExportOptions): Promise<ExportSummary> {
  const notes = await collectNotes(app, opts.fields ?? DEFAULT_FIELDS);
  // FileSystemAdapter exposes getBasePath(); duck-type it to keep `obsidian` type-only.
  const adapter = app.vault.adapter as { getBasePath?: () => string } | undefined;
  const vaultPath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : undefined;
  const { generated, warnings, errors } = transformAll(notes, { pluginName: opts.pluginName, synthesizeRoot: true, vaultPath });

  ensurePluginManifest(opts.outputDir, opts.pluginName, opts.pluginDescription);

  // Overwrite: remove previously-generated files (tracked in the manifest), then write.
  const manifestPath = path.join(opts.outputDir, MANIFEST_NAME);
  let prev: string[] = [];
  try { prev = JSON.parse(fs.readFileSync(manifestPath, "utf8")).files ?? []; } catch { /* no prior manifest */ }

  // Emit generated content plus the shipped static skills (static wins on name collision),
  // so one export yields the complete plugin at the output dir — no separate symlink.
  const staticRelOuts = new Set(STATIC_FILES.map((s) => s.relOut));
  const files = [
    ...generated.filter((g) => !staticRelOuts.has(g.relOut)),
    ...STATIC_FILES.map((s) => ({ kind: "skill" as const, relOut: s.relOut, content: s.content, from: "(static)" })),
  ];

  const nextFiles = files.map((g) => g.relOut);
  const toRemove = prev.filter((p) => !nextFiles.includes(p));
  for (const rel of toRemove) {
    const abs = path.join(opts.outputDir, rel);
    try { fs.rmSync(abs, { force: true }); } catch { /* ignore */ }
    const parent = path.dirname(abs);
    try { if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent); } catch { /* ignore */ }
  }

  for (const g of files) {
    const abs = path.join(opts.outputDir, g.relOut);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, g.content);
  }

  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedFrom: "obsidian-vault-skills",
    vault: vaultPath ?? null,
    count: files.length,
    files: nextFiles.sort(),
  }, null, 2) + "\n");

  return {
    skills: files.filter((g) => g.kind === "skill").length,
    agents: files.filter((g) => g.kind === "agent").length,
    removed: toRemove.length,
    warnings,
    errors,
    outputDir: opts.outputDir,
  };
}

/** Make sure the output dir is a valid Claude Code plugin (create manifest if absent). */
function ensurePluginManifest(outputDir: string, name: string, description?: string): void {
  const file = path.join(outputDir, ".claude-plugin", "plugin.json");
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    name,
    description: description || `Skills and agents exported from an Obsidian vault by ${name}.`,
    version: "0.1.0",
  }, null, 2) + "\n");
}
