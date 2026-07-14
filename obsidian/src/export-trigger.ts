// Export-on-save trigger.
//
// Renaming a skill/agent/policy note makes Obsidian emit a *burst* of metadataCache
// "changed" events — the file rename itself, plus a cascaded `[[wikilink]]` rewrite in
// every child note whose `parent:` pointed at the old name. Exporting on each event would
// validate a half-rewritten tree: a child's `parent` link still resolves to the pre-rename
// basename (now missing), so the transform reports a spurious `unresolved parent` error and
// drops the child from the output. Debouncing collapses the burst into a single export once
// the cache has settled and every cascaded link rewrite is done, so validation always runs
// against the consistent post-rename tree.

import { fieldView, type FieldConfig } from "./exporter.js";

/** Minimal trailing debounce: `fn` runs once, `waitMs` after the last call. Kept local
 *  (rather than Obsidian's `debounce`) so the coalescing is unit-testable outside the
 *  Obsidian runtime. */
export function debounce(fn: () => void, waitMs: number): () => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn();
    }, waitMs);
  };
}

export interface ChangeTriggerDeps {
  /** Whether export-on-save is enabled. */
  isEnabled: () => boolean;
  /** Current field-namespacing config. */
  fields: () => FieldConfig;
  /** Frontmatter of the changed file, or undefined if it has none. */
  getFrontmatter: (file: unknown) => Record<string, unknown> | undefined;
  /** Request an export. Debounced upstream so a rename's burst collapses into one run. */
  requestExport: () => void;
}

/** Handle a metadataCache "changed" event: request a (debounced) export only when the
 *  changed note is a skill/agent/policy — read through the configured field mode so a bare
 *  `type:` on an unrelated note doesn't false-positive. */
export function handleNoteChanged(file: unknown, deps: ChangeTriggerDeps): void {
  if (!deps.isEnabled()) return;
  const fm = deps.getFrontmatter(file);
  if (!fm) return;
  const { view } = fieldView(fm, deps.fields());
  if (view.type === "skill" || view.type === "agent" || view.type === "policy") deps.requestExport();
}
