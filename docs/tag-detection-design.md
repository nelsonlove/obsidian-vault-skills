# Design: tag-based type detection

## Goal

Let a note's **kind** (skill / agent / policy) be declared by an Obsidian **tag**
instead of the `type:` frontmatter field. Chosen per vault via a setting; the
frontmatter `type:` convention stays the default and keeps working unchanged.

Default tag scheme is nested under `agent/`:

- `#agent/agent`
- `#agent/skill`
- `#agent/policy`

## Decisions (locked)

1. **Replace, not augment.** A global `typeSource` setting picks one convention
   for the vault: `frontmatter` (current) *or* `tags`. In `tags` mode the plugin
   ignores `type:` entirely and reads the tag; in `frontmatter` mode it ignores
   tags entirely. No mixed/either-or mode.
2. **Configurable prefix, namespaced default.** `tagPrefix` defaults to `agent/`.
   The kind tag is `#{tagPrefix}{kind}`. A blank prefix yields bare `#skill` /
   `#agent` / `#policy`.
3. **Only the discriminator moves.** The tag decides *kind* only. `parent`
   (`[[wikilink]]`), `description`, `name`, `tools`, `model`, `id`, `root`,
   `crosscutting`, `slot`, and the SKILL.md passthrough fields are still read from
   frontmatter through the existing field mode (prefix/nested), even in tags mode.
   Tags cannot express a wikilink parent or a description, so they stay put.

## Architecture

The transform (`transform.ts`) is unchanged — it stays namespace- and
tag-agnostic and keeps reading `frontmatter.type`. All new logic lives in the
Obsidian-coupled layer (`exporter.ts` + call sites), which normalizes a note's
kind into `view.type` before handing notes to the transform.

### New settings (`settings.ts`)

```ts
typeSource: "frontmatter" | "tags";  // default "frontmatter" (back-compatible)
tagPrefix: string;                    // default "agent/"
```

UI mirrors the existing field-mode pattern: a **Type source** dropdown, and — when
it is `tags` — a conditional **Tag prefix** text field whose description shows the
three resulting tags. Existing users load with `typeSource: "frontmatter"`, so
behavior is identical until they opt in.

### Kind resolution (pure, unit-tested)

```ts
// pure — no `obsidian` runtime import, fully testable
type Kind3 = "skill" | "agent" | "policy";

extractTags(cache): string[]        // merge frontmatter `tags:` (stored un-#'d)
                                    // + inline `cache.tags[].tag`; normalize to `#tag`
tagKind(tags: string[], prefix): Kind3 | null | "ambiguous"
```

- `tagKind` matches `#{prefix}{kind}` case-insensitively (Obsidian tag matching is
  case-insensitive). Exact leaf match only — `#agent/skill/foo` does not match.
- If a note carries two different kind-tags (e.g. `#agent/skill` **and**
  `#agent/agent`) → `"ambiguous"` → the note is skipped with a warning.

`extractTags` reads the plain cache shape (`cache.frontmatter?.tags`, an array or a
string; and `cache.tags` = `[{ tag: "#…" }]`). No `getAllTags` import — that would
be a runtime `obsidian` dependency and break the node test runner, which stubs
`app` by hand and never imports `obsidian`.

### `collectNotes` (`exporter.ts`) — the one gate

```ts
collectNotes(app, cfg, warnings?): NoteInput[]
```

Per markdown file:

1. `fm = getFileCache(file)?.frontmatter` (unchanged) and `cache = getFileCache(file)`.
2. `{ view, parent } = fieldView(fm, cfg)` — unchanged; extracts parent/description/etc.
3. Resolve kind:
   - `frontmatter` mode → `normKind(view.type)` (current behavior).
   - `tags` mode → `tagKind(extractTags(cache), cfg.tagPrefix)`; `"ambiguous"` →
     push a warning and skip.
4. If no kind → skip. Otherwise **set `view.type = kind`** and push the note.

Because step 4 writes `view.type`, `transform.ts` and the `analyzeVault` policy
count keep reading `frontmatter.type` with zero changes.

`warnings?` is a new **optional** sink parameter. `runExport` and `analyzeVault`
pass their existing warning arrays so ambiguity surfaces in the export Notice; the
existing test call sites omit it and keep compiling unchanged.

### Config threading

A `DetectConfig` extends `FieldConfig` with `typeSource` and `tagPrefix`. Functions
that classify notes (`collectNotes`, `analyzeVault`, `runExport` via `opts.fields`,
the save handler, the mark helpers) take `DetectConfig`; `fieldView` still takes the
narrower `FieldConfig`. `main.ts`, `commands.ts`, and `mcp/tools.ts` build the
config from settings via a small `detectOf(settings)` helper (parallel to the
existing `fieldsOf`).

### Write path — `mark` (`markFrontmatter` + `applyMark`)

```ts
markFrontmatter(input, cfg): { set: Record<string, unknown>; addTags: string[] }
applyMark(fm, result): void   // shared mutator
```

- `frontmatter` mode → `set` carries `type` (+ parent/description/root) per field
  mode; `addTags` is empty. Identical to today.
- `tags` mode → `set` carries parent/description only; `addTags = ["#{prefix}{kind}"]`.
- `applyMark` does `Object.assign(fm, set)` then dedup-appends each tag into
  `fm.tags` (creating the array if absent). Both the `mark` command and the MCP
  `vault_skills_mark` tool call `applyMark`, so tag-append logic lives in one place
  and existing `Object.assign`-then-clobber-tags bugs are avoided.

### Save handler (`main.ts` exportOnSave)

Refactored to resolve kind through the same path (it has `app` → cache → tags), so
tag-marked notes trigger re-export too.

## Out of scope (v1)

- The `new-skill` authoring scaffold (a static skill) still writes `type:`
  frontmatter. Detection is the ask; teaching the scaffold to emit a tag in tags
  mode is a follow-up.

## Testing

- Pure: `tagKind` (each kind, no-match, ambiguous, blank-prefix bare tags,
  case-insensitivity) and `extractTags` (frontmatter list, frontmatter string,
  inline, merge/dedupe).
- `collectNotes` in tags mode via an extended mock (`getFileCache` returns
  `{ frontmatter, tags }`); asserts kind detection, ambiguity skip + warning, and
  that parent/description still come from frontmatter.
- `markFrontmatter` + `applyMark`: tags-mode append, dedupe, frontmatter-mode
  unchanged.
- `transform.test.mjs` untouched (transform unchanged) — a guard that the seam held.

## Docs

Update `docs/frontmatter-convention.md`, `README.md`, and the MCP `vault_skills_mark`
tool description to document tags mode and the `agent/` default.
