import type { App } from "obsidian";
import * as fs from "node:fs";
import * as path from "node:path";
import { transformAll, SKILL_PASSTHROUGH_FIELDS, type NoteInput, type TreeNode } from "./transform.js";
import { STATIC_FILES } from "./static-skills.js";
import { assetDirFor, collectAssets, copyAsset, type CollectAssetsOptions } from "./assets.js";

const MANIFEST_NAME = ".vault-skills-manifest.json";

/** How the vault-skills fields are namespaced in a note's frontmatter. */
export interface FieldConfig {
  mode: "prefix" | "nested";
  prefix: string; // e.g. "vs-" → vs-type, vs-parent (prefix mode)
  key: string;    // e.g. "vault-skills" → nested object (nested mode)
}

export const DEFAULT_FIELDS: FieldConfig = { mode: "prefix", prefix: "", key: "vault-skills" };

/** The note `type` values that produce plugin output (skills, agents, and the policies
 *  folded into agents). Single source of truth for "does this note participate in the
 *  export" — shared by collection (collectNotes) and the export-on-save relevance check. */
export const EXPORTABLE_TYPES = ["skill", "agent", "policy"] as const;
export function isExportableType(type: unknown): type is (typeof EXPORTABLE_TYPES)[number] {
  return type === "skill" || type === "agent" || type === "policy";
}

export interface ExportOptions {
  outputDir: string;
  pluginName: string;
  pluginDescription?: string;
  fields?: FieldConfig;
  /** Root of a parallel filesystem tree holding skills' supporting files (see assets.ts).
   *  Empty/unset ⇒ no supporting files are bundled. */
  assetsRoot?: string;
  /** When set, write this version into the output's .claude-plugin/plugin.json
   *  (creating or updating it) — used by the release export. */
  version?: string;
  /** Test hook: overrides for iCloud materialization (downloader, poll, timeout). */
  assetOptions?: CollectAssetsOptions;
}

export interface ExportSummary {
  skills: number;
  agents: number;
  assets: number;
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

// The vault-skills fields the transform reads (parent is handled separately, resolved to
// paths), plus the SKILL.md passthrough fields — all namespaced the same way.
const VS_FIELDS = [...new Set(["type", "root", "name", "id", "label", "description", "version", "tools", "model",
  "crosscutting", "slot", ...SKILL_PASSTHROUGH_FIELDS])];

/** Extract a bare view of the vault-skills fields (+ the raw parent value) per the field mode,
 *  so the pure transform stays namespace-agnostic. */
export function fieldView(fm: Record<string, unknown>, cfg: FieldConfig): { view: Record<string, unknown>; parent: unknown } {
  if (cfg.mode === "nested") {
    const nested = (fm[cfg.key] && typeof fm[cfg.key] === "object" ? fm[cfg.key] : {}) as Record<string, unknown>;
    return { view: nested, parent: nested.parent };
  }
  // prefix mode — a blank prefix yields bare top-level fields (type, parent, …)
  const view: Record<string, unknown> = {};
  for (const f of VS_FIELDS) view[f] = fm[cfg.prefix + f];
  return { view, parent: fm[cfg.prefix + "parent"] };
}

/** Collect every note whose (namespaced) frontmatter marks it a skill/agent/policy. */
export async function collectNotes(app: App, fields: FieldConfig = DEFAULT_FIELDS): Promise<NoteInput[]> {
  const notes: NoteInput[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) continue;
    const { view, parent } = fieldView(fm, fields);
    if (!isExportableType(view.type)) continue;
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

  ensurePluginManifest(opts.outputDir, opts.pluginName, opts.pluginDescription, opts.version);

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

  // Supporting files: each skill note may have a parallel folder of assets (scripts,
  // references) that gets bundled into its generated skills/<name>/ dir. Asset trouble
  // (unreadable dir, iCloud timeout) degrades to a warning for that skill — it must
  // never abort the export. A file that fails to materialize keeps its previously
  // exported copy rather than having stale-cleanup delete it.
  const assetCopies: { src: string; relOut: string }[] = [];
  const retained: string[] = [];
  if (opts.assetsRoot) {
    for (const g of files) {
      if (g.kind !== "skill" || !g.from.endsWith(".md")) continue; // skip static/synthesized
      const dir = assetDirFor(opts.assetsRoot, g.from);
      const skillDir = path.dirname(g.relOut);
      try {
        const { files: assets, failed, warnings: assetWarnings } = await collectAssets(dir, opts.assetOptions);
        warnings.push(...assetWarnings);
        for (const a of assets) {
          if (a.rel === "SKILL.md") { warnings.push(`${dir}/SKILL.md: supporting file would overwrite the generated SKILL.md — skipped`); continue; }
          assetCopies.push({ src: a.abs, relOut: `${skillDir}/${a.rel}` });
        }
        for (const rel of failed) {
          const relOut = `${skillDir}/${rel}`;
          if (prev.includes(relOut)) {
            retained.push(relOut);
            warnings.push(`${relOut}: kept the previously exported copy`);
          }
        }
      } catch (e) {
        warnings.push(`${dir}: could not read supporting files — ${e instanceof Error ? e.message : String(e)}; skipped`);
      }
    }
  }

  const nextFiles = [...files.map((g) => g.relOut), ...assetCopies.map((a) => a.relOut), ...retained];
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
  for (const a of assetCopies) {
    try {
      copyAsset(a.src, path.join(opts.outputDir, a.relOut));
    } catch (e) {
      warnings.push(`${a.relOut}: copy failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedFrom: "obsidian-vault-skills",
    vault: vaultPath ?? null,
    count: nextFiles.length,
    files: nextFiles.sort(),
  }, null, 2) + "\n");

  return {
    skills: files.filter((g) => g.kind === "skill").length,
    agents: files.filter((g) => g.kind === "agent").length,
    assets: assetCopies.length,
    removed: toRemove.length,
    warnings,
    errors,
    outputDir: opts.outputDir,
  };
}

export interface Analysis {
  tree: TreeNode[];
  errors: string[];
  warnings: string[];
  counts: { skills: number; agents: number; policies: number };
}

/** Shared read-only core for `validate` and `tree`: collect + transform, no write. */
export async function analyzeVault(app: App, fields: FieldConfig = DEFAULT_FIELDS, pluginName = "vault-skills"): Promise<Analysis> {
  const notes = await collectNotes(app, fields);
  const adapter = app.vault.adapter as { getBasePath?: () => string } | undefined;
  const vaultPath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : undefined;
  const { tree, warnings, errors } = transformAll(notes, { pluginName, synthesizeRoot: true, vaultPath });
  return {
    tree, errors, warnings,
    counts: {
      agents: tree.filter((n) => n.kind === "agent").length,
      skills: tree.filter((n) => n.kind === "skill").length,
      policies: notes.filter((n) => n.frontmatter.type === "policy").length,
    },
  };
}

export interface MarkInput {
  type: "skill" | "agent" | "policy";
  parent?: string;      // agent basename or [[wikilink]]; empty ⇒ root
  description?: string;
  root?: boolean;
}

/** Pure: the frontmatter keys to set on a note to mark it, honoring the field mode. */
export function markFrontmatter(input: MarkInput, fields: FieldConfig = DEFAULT_FIELDS): Record<string, unknown> {
  const flat: Record<string, unknown> = { type: input.type };
  if (input.root) flat.root = true;
  if (input.parent) flat.parent = input.parent.startsWith("[[") ? input.parent : `[[${input.parent}]]`;
  if (input.description) flat.description = input.description;
  if (fields.mode === "nested") return { [fields.key]: flat };
  // prefix mode — a blank prefix yields bare top-level fields
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) out[fields.prefix + k] = v;
  return out;
}

/** Make sure the output dir is a valid Claude Code plugin (create manifest if absent).
 *  When `version` is given (release export), set it on the manifest — creating the file
 *  or updating an existing one in place, preserving its other fields. */
function ensurePluginManifest(outputDir: string, name: string, description?: string, version?: string): void {
  const file = path.join(outputDir, ".claude-plugin", "plugin.json");
  if (fs.existsSync(file)) {
    if (!version) return;
    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(fs.readFileSync(file, "utf8")); } catch {
      // Never clobber a manifest we can't parse — its fields (description, author, …)
      // would be silently lost.
      throw new Error(`${file} is not valid JSON — fix or remove it, then re-run the release export`);
    }
    fs.writeFileSync(file, JSON.stringify({ name, ...manifest, version }, null, 2) + "\n");
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    name,
    description: description || `Skills and agents exported from an Obsidian vault by ${name}.`,
    version: version ?? "0.1.0",
  }, null, 2) + "\n");
}

/** Read the version from an existing plugin manifest (for suggesting the next release). */
export function readPluginVersion(outputDir: string): string | undefined {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(outputDir, ".claude-plugin", "plugin.json"), "utf8")).version;
    return typeof v === "string" ? v : undefined;
  } catch { return undefined; }
}
