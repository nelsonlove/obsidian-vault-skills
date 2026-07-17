# Preview — compiled output before export

Show the compiled Claude Code output — per definition and whole-tree — before anything is
written, in both surfaces: an MCP tool for agents and an Obsidian view for the author.
Answers two questions the existing tools don't: *what does Claude actually see for this
note?* (listing line + full compiled file) and *what would an export change right now?*
(diff against the current output dir).

## Core: `previewVault` (exporter.ts)

One function next to `analyzeVault`, sharing the same collect + transform path (with
transclusion resolution, so bodies are the real compiled bodies), returning what
`analyzeVault` discards plus a diff against the configured output dir:

- `entries: PreviewEntry[]` — one per file the export would write: `kind`, `relOut`,
  `from`, `content`, `bytes`, the listing line (`name`, `description` — carried on
  `Generated` by the transform, not re-parsed from frontmatter), and
  `status: added | modified | unchanged` (byte-compare against `outputDir/relOut`;
  `cachedContent` included on modified entries). Static files are merged exactly as
  `runExport` merges them (static wins on collision), so preview and export always
  describe the same file set.
- `removed: string[]` — previously exported files no export would rewrite. Read from the
  same `.vault-skills-manifest.json` the export uses, considering only generated-shaped
  paths (`skills/*/SKILL.md`, `agents/*.md`, `commands/*.md`, static relOuts). Everything
  else in the manifest is a bundled asset: assets are **not previewed** (collecting them
  can trigger iCloud materialization — a side effect preview must not have) and are
  excluded from removal detection rather than reported as phantom removals.
- `diff` — added / modified / unchanged / removed counts.
- `policies: PolicyPlacement[]` — policy note → the agent files its body actually landed
  in (lineage injection + `severity: hard` inlining into crosscutting agents), recorded by
  the transform during render rather than re-derived.
- `tree`, `errors`, `warnings`, `counts` — as `analyzeVault`.

Missing output dir or manifest ⇒ everything `added`, nothing `removed`. Transform errors
pass through; preview still renders whatever compiled.

## MCP tool: `vault_skills_preview`

Read-only. No args ⇒ manifest view: per-entry `{kind, relOut, from, name, description,
bytes, status}` + `removed` + `diff` + `policies` + errors/warnings/counts.
`name` (matches generated name, relOut, or source path) ⇒ that entry with full `content`
(+ `cachedContent` when modified). `content: true` ⇒ full contents for every entry —
large, the description says so. `validate` and `tree` are unchanged; preview supersedes
neither.

## Obsidian view

A registered `ItemView` (`vault-skills-preview`), opened by command ("Preview compiled
output"). Left: the tree (agents nested, skills under their owners), then flat groups for
commands, policies (with where-they-landed), static files, and removed files — every node
badged by diff status. Right: the selected entry with tabs — **Listing** (the name +
description exactly as Claude Code's lists render it, plus a link to the source note),
**Compiled** (full rendered file, read-only), and **Diff** (current export vs. preview,
shown as both versions) when modified. Header: refresh button + diff summary. Refresh is
manual, plus debounced auto-refresh on relevant note changes (same relevance check as
export-on-save) while the view is open. No persisted state — the view is always a fresh
`previewVault` render.

## Testing

`tests/preview.test.mjs`, house pattern (node:test + tsx + mock App + tmp dirs): diff
classification (fresh dir ⇒ all added; after `runExport` ⇒ all unchanged; edit ⇒
modified; drop a note ⇒ removed), asset manifest entries excluded from removal, listing
fields present, policy placement (lineage + hard/crosscutting). The view is verified
manually — no DOM test rig exists and it isn't worth adding for this.
