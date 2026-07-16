import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTransclusions, MAX_EMBED_DEPTH } from "../src/transclude.ts";

/** Lookup over a fixture map of vault-path → raw file content. Linkpaths resolve by
 *  basename (with or without .md), mimicking Obsidian's shortest-path resolution. */
const lookupOf = (files) => async (linkpath) => {
  const want = linkpath.replace(/\.md$/, "");
  for (const [path, content] of Object.entries(files)) {
    const base = path.split("/").pop().replace(/\.md$/, "");
    if (base === want || path.replace(/\.md$/, "") === want) return { path, content };
  }
  return null;
};

const resolve = (body, files, warnings = []) =>
  resolveTransclusions(body, "source.md", lookupOf(files), warnings);

test("full-note embed inlines the body with frontmatter stripped", async () => {
  const warnings = [];
  const out = await resolve("before\n\n![[Target]]\n\nafter", {
    "notes/Target.md": "---\ntitle: Target\ntags: [x]\n---\n\nTarget body line 1\nline 2",
  }, warnings);
  assert.equal(out, "before\n\nTarget body line 1\nline 2\n\nafter");
  assert.equal(warnings.length, 0);
});

test("heading embed extracts that section only, heading line included", async () => {
  const out = await resolve("![[Target#Middle]]", {
    "Target.md": "# Top\n\nintro\n\n## Middle\n\nmiddle body\n\n### Sub\n\nsub body\n\n## Later\n\nlater body",
  });
  assert.equal(out, "## Middle\n\nmiddle body\n\n### Sub\n\nsub body");
});

test("heading match is case-insensitive", async () => {
  const out = await resolve("![[Target#middle section]]", {
    "Target.md": "## Middle Section\n\nbody",
  });
  assert.equal(out, "## Middle Section\n\nbody");
});

test("block embed extracts the anchored paragraph, marker stripped", async () => {
  const out = await resolve("![[Target#^abc123]]", {
    "Target.md": "para one\n\npara two line 1\npara two line 2 ^abc123\n\npara three",
  });
  assert.equal(out, "para two line 1\npara two line 2");
});

test("nested embeds resolve recursively", async () => {
  const out = await resolve("![[A]]", {
    "A.md": "A says: ![[B]]",
    "B.md": "B content",
  });
  assert.equal(out, "A says: B content");
});

test("cycle is left unresolved with a warning", async () => {
  const warnings = [];
  const out = await resolve("![[A]]", {
    "A.md": "A: ![[B]]",
    "B.md": "B: ![[A]]",
  }, warnings);
  assert.equal(out, "A: B: ![[A]]");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cycle/);
});

test("depth cap leaves the deepest embed unresolved with a warning", async () => {
  const files = {};
  for (let i = 0; i <= MAX_EMBED_DEPTH + 1; i++) files[`N${i}.md`] = `n${i} ![[N${i + 1}]]`;
  const warnings = [];
  const out = await resolve("![[N0]]", files, warnings);
  assert.match(out, /!\[\[N\d+\]\]/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /depth/);
});

test("unresolved target is left as-is with a warning", async () => {
  const warnings = [];
  const out = await resolve("keep ![[Missing]] here", {}, warnings);
  assert.equal(out, "keep ![[Missing]] here");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unresolved transclusion !\[\[Missing\]\]/);
});

test("missing heading/block is left as-is with a warning", async () => {
  const warnings = [];
  const out = await resolve("![[Target#Nope]] and ![[Target#^nope]]", {
    "Target.md": "# Yes\n\nbody ^yes",
  }, warnings);
  assert.equal(out, "![[Target#Nope]] and ![[Target#^nope]]");
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /section not found/);
});

test("attachment embeds (non-md extensions) are untouched, no warning", async () => {
  const warnings = [];
  const out = await resolve("![[photo.png]] ![[Doc.pdf]]", {}, warnings);
  assert.equal(out, "![[photo.png]] ![[Doc.pdf]]");
  assert.equal(warnings.length, 0);
});

test("embeds in fenced code blocks and inline code spans are documentation — skipped", async () => {
  const warnings = [];
  const body = "Use `![[X]]` like this:\n\n```md\n![[X]]\n```\n\n![[Real]]";
  const out = await resolve(body, { "Real.md": "resolved" }, warnings);
  assert.equal(out, "Use `![[X]]` like this:\n\n```md\n![[X]]\n```\n\nresolved");
  assert.equal(warnings.length, 0);
});

test("alias after | is display-only and ignored", async () => {
  const out = await resolve("![[Target|shown as]]", { "Target.md": "body" });
  assert.equal(out, "body");
});

test("nested heading path targets the last segment", async () => {
  const out = await resolve("![[Target#Top#Inner]]", {
    "Target.md": "# Top\n\n## Inner\n\ninner body",
  });
  assert.equal(out, "## Inner\n\ninner body");
});

test("body without embeds passes through untouched", async () => {
  const body = "plain [[wikilink]] and ![image](url) but no embeds";
  assert.equal(await resolve(body, {}), body);
});

test("relative resolution: nested embed resolves from the embedded note's path", async () => {
  const calls = [];
  const lookup = async (linkpath, fromPath) => {
    calls.push([linkpath, fromPath]);
    if (linkpath === "A") return { path: "dir/A.md", content: "![[B]]" };
    if (linkpath === "B") return { path: "dir/B.md", content: "b" };
    return null;
  };
  const out = await resolveTransclusions("![[A]]", "source.md", lookup, []);
  assert.equal(out, "b");
  assert.deepEqual(calls, [["A", "source.md"], ["B", "dir/A.md"]]);
});
