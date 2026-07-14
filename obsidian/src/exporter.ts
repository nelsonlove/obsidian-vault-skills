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

/** FieldConfig plus how a note's *kind* (skill/agent/policy) is declared. In "tags" mode the
 *  kind comes from a `#{tagPrefix}{kind}` tag and any `type:` frontmatter is ignored; every other
 *  field (parent, description, …) is still read from frontmatter per the FieldConfig. Both extras
 *  are optional so a bare FieldConfig behaves exactly like frontmatter mode with the default prefix. */
export interface DetectConfig extends FieldConfig {
  typeSource?: "frontmatter" | "tags";
  tagPrefix?: string; // e.g. "agent/" → #agent/skill, #agent/agent, #agent/policy
}

export const DEFAULT_FIELDS: FieldConfig = { mode: "prefix", prefix: "", key: "vault-skills" };
export const DEFAULT_TAG_PREFIX = "agent/";

const KINDS = ["skill", "agent", "policy"] as const;
type Kind3 = (typeof KINDS)[number];

/** Normalize a raw frontmatter `type` value to a known kind, or null. */
export function normKind(v: unknown): Kind3 | null {
  return v === "skill" || v === "agent" || v === "policy" ? v : null;
}

/** Merge a note's frontmatter `tags` (Obsidian stores them without `#`) and inline
 *  `cache.tags[].tag` into normalized `#tag` strings. Pure — takes the plain cache shape so it
 *  needs no `obsidian` runtime import (which would break the node test runner). */
export function extractTags(
  cache: { frontmatter?: Record<string, unknown>; tags?: { tag?: unknown }[] } | null | undefined,
): string[] {
  if (!cache) return [];
  const out: string[] = [];
  const push = (raw: unknown): void => {
    const s = String(raw).trim();
    if (s) out.push(s.startsWith("#") ? s : `#${s}`);
  };
  const fmTags = cache.frontmatter?.tags;
  if (Array.isArray(fmTags)) for (const t of fmTags) push(t);
  else if (typeof fmTags === "string") for (const t of fmTags.split(/[,\s]+/)) push(t);
  for (const t of cache.tags ?? []) if (t?.tag != null) push(t.tag);
  return out;
}

/** Which kind a set of tags declares under `prefix` (case-insensitive, exact leaf), or null;
 *  "ambiguous" when more than one distinct kind tag is present. */
export function tagKind(tags: string[], prefix: string): Kind3 | null | "ambiguous" {
  const have = new Set(tags.map((t) => t.toLowerCase()));
  const hits = KINDS.filter((k) => have.has(`#${prefix}${k}`.toLowerCase()));
  return hits.length === 0 ? null : hits.length > 1 ? "ambiguous" : hits[0];
}

/** Resolve a note's kind per the detection mode. `view` is the field-mode frontmatter view. */
export function detectKind(
  view: Record<string, unknown>,
  cache: { frontmatter?: Record<string, unknown>; tags?: { tag?: unknown }[] } | null | undefined,
  cfg: DetectConfig,
): Kind3 | null | "ambiguous" {
  if ((cfg.typeSource ?? "frontmatter") === "tags") return tagKind(extractTags(cache), cfg.tagPrefix ?? DEFAULT_TAG_PREFIX);
  return normKind(view.type);
}

export interface ExportOptions {
  outputDir: string;
  pluginName: string;
  pluginDescription?: string;
  fields?: DetectConfig;
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

/** Collect every note marked a skill/agent/policy — by its `type:` field (frontmatter mode) or a
 *  `#{tagPrefix}{kind}` tag (tags mode). Ambiguous tag notes are skipped, reported via `warnings`. */
export async function collectNotes(app: App, fields: DetectConfig = DEFAULT_FIELDS, warnings?: string[]): Promise<NoteInput[]> {
  const tagsMode = (fields.typeSource ?? "frontmatter") === "tags";
  const notes: NoteInput[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file) as { frontmatter?: Record<string, unknown>; tags?: { tag?: unknown }[] } | null;
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    // Frontmatter mode needs frontmatter to hold `type:`; tags mode can qualify on an inline tag alone.
    if (!fm && !tagsMode) continue;
    const { view, parent } = fieldView(fm ?? {}, fields);
    const kind = detectKind(view, cache, fields);
    if (kind === "ambiguous") {
      warnings?.push(`${file.path}: multiple vault-skills kind tags — skipped (tag it as exactly one of skill/agent/policy)`);
      continue;
    }
    if (!kind) continue;
    view.type = kind; // normalize so the transform (and policy count) read a single source of truth
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
  const collectWarnings: string[] = [];
  const notes = await collectNotes(app, opts.fields ?? DEFAULT_FIELDS, collectWarnings);
  // FileSystemAdapter exposes getBasePath(); duck-type it to keep `obsidian` type-only.
  const adapter = app.vault.adapter as { getBasePath?: () => string } | undefined;
  const vaultPath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : undefined;
  const { generated, warnings, errors } = transformAll(notes, { pluginName: opts.pluginName, synthesizeRoot: true, vaultPath });
  warnings.unshift(...collectWarnings);

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
export async function analyzeVault(app: App, fields: DetectConfig = DEFAULT_FIELDS, pluginName = "vault-skills"): Promise<Analysis> {
  const collectWarnings: string[] = [];
  const notes = await collectNotes(app, fields, collectWarnings);
  const adapter = app.vault.adapter as { getBasePath?: () => string } | undefined;
  const vaultPath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : undefined;
  const { tree, warnings, errors } = transformAll(notes, { pluginName, synthesizeRoot: true, vaultPath });
  return {
    tree, errors, warnings: [...collectWarnings, ...warnings],
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

export interface MarkResult {
  /** Frontmatter keys to Object.assign onto the note (already namespaced per field mode). */
  set: Record<string, unknown>;
  /** Kind tags (with a leading `#`) to append to the note's `tags` — non-empty only in tags mode. */
  addTags: string[];
}

/** Pure: how to mark a note as a given kind, honoring the field mode and detection mode. In tags
 *  mode the kind becomes a tag (`addTags`) instead of a `type:` field; parent/description/root
 *  stay frontmatter fields in both modes. Apply with {@link applyMark}. */
export function markFrontmatter(input: MarkInput, fields: DetectConfig = DEFAULT_FIELDS): MarkResult {
  const tagsMode = (fields.typeSource ?? "frontmatter") === "tags";
  const addTags: string[] = [];
  const flat: Record<string, unknown> = {};
  if (tagsMode) addTags.push(`#${fields.tagPrefix ?? DEFAULT_TAG_PREFIX}${input.type}`);
  else flat.type = input.type;
  if (input.root) flat.root = true;
  if (input.parent) flat.parent = input.parent.startsWith("[[") ? input.parent : `[[${input.parent}]]`;
  if (input.description) flat.description = input.description;

  let set: Record<string, unknown>;
  if (fields.mode === "nested") set = Object.keys(flat).length ? { [fields.key]: flat } : {};
  else {
    // prefix mode — a blank prefix yields bare top-level fields
    set = {};
    for (const [k, v] of Object.entries(flat)) set[fields.prefix + k] = v;
  }
  return { set, addTags };
}

/** Apply a {@link markFrontmatter} result to a note's frontmatter object in place: assign the
 *  fields, then dedup-append each kind tag into `tags` (stored bare, without `#`, as Obsidian does). */
export function applyMark(fm: Record<string, unknown>, result: MarkResult): void {
  Object.assign(fm, result.set);
  if (!result.addTags.length) return;
  const existing = Array.isArray(fm.tags) ? fm.tags.slice() : fm.tags == null ? [] : [fm.tags];
  const have = new Set(existing.map((t) => String(t).replace(/^#/, "").toLowerCase()));
  for (const tag of result.addTags) {
    const bare = tag.replace(/^#/, "");
    if (!have.has(bare.toLowerCase())) {
      existing.push(bare);
      have.add(bare.toLowerCase());
    }
  }
  fm.tags = existing;
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
