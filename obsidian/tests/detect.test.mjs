import { test } from "node:test";
import assert from "node:assert/strict";
import { collectNotes, extractTags, tagKind, markFrontmatter, applyMark } from "../src/exporter.ts";

// App stand-in that carries per-note inline `tags` in the cache alongside frontmatter.
function mockApp(notes) {
  const files = notes.map((n) => ({ path: n.path, basename: n.path.replace(/\.md$/, "").split("/").pop() }));
  const byPath = new Map(notes.map((n) => [n.path, n]));
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (f) => byPath.get(f.path).content ?? "body",
    },
    metadataCache: {
      getFileCache: (f) => ({ frontmatter: byPath.get(f.path).frontmatter, tags: byPath.get(f.path).tags }),
      getFirstLinkpathDest: (lp) => files.find((f) => f.basename === lp || f.path === lp || f.path === `${lp}.md`) ?? null,
    },
  };
}

test("extractTags merges frontmatter list, frontmatter string, and inline tags → normalized #tags", () => {
  assert.deepEqual(extractTags({ frontmatter: { tags: ["agent/skill", "x"] } }), ["#agent/skill", "#x"]);
  assert.deepEqual(extractTags({ frontmatter: { tags: "agent/skill x" } }), ["#agent/skill", "#x"]);
  assert.deepEqual(extractTags({ tags: [{ tag: "#agent/agent" }] }), ["#agent/agent"]);
  assert.deepEqual(extractTags(null), []);
});

test("tagKind matches #{prefix}{kind} case-insensitively; blank prefix = bare tags", () => {
  assert.equal(tagKind(["#agent/skill"], "agent/"), "skill");
  assert.equal(tagKind(["#Agent/Skill"], "agent/"), "skill"); // case-insensitive
  assert.equal(tagKind(["#skill"], ""), "skill"); // bare
  assert.equal(tagKind(["#agent/foo"], "agent/"), null); // unrelated
  assert.equal(tagKind(["#agent/skill", "#agent/agent"], "agent/"), "ambiguous");
});

test("collectNotes in tags mode reads the kind tag; parent/description stay frontmatter; type: ignored", async () => {
  const notes = [
    { path: "grants.md", frontmatter: { name: "grants" }, tags: [{ tag: "#agent/agent" }], content: "body" },
    { path: "sweep.md", frontmatter: { name: "sweep", parent: "[[grants]]", tags: ["agent/skill"] }, content: "body" },
    { path: "plain.md", frontmatter: { type: "agent" }, content: "body" }, // bare type: — ignored in tags mode
  ];
  const cfg = { mode: "prefix", prefix: "", key: "", typeSource: "tags", tagPrefix: "agent/" };
  const got = await collectNotes(mockApp(notes), cfg);
  assert.equal(got.length, 2, "grants (inline) + sweep (frontmatter); plain.md ignored");
  assert.equal(got.find((n) => n.path === "grants.md").frontmatter.type, "agent");
  const sweep = got.find((n) => n.path === "sweep.md");
  assert.equal(sweep.frontmatter.type, "skill");
  assert.deepEqual(sweep.parentPaths, ["grants.md"], "parent still resolved from frontmatter");
});

test("collectNotes in tags mode skips ambiguous notes with a warning", async () => {
  const notes = [{ path: "amb.md", frontmatter: { name: "amb", tags: ["agent/skill", "agent/agent"] }, content: "body" }];
  const warnings = [];
  const got = await collectNotes(mockApp(notes), { mode: "prefix", prefix: "", key: "", typeSource: "tags", tagPrefix: "agent/" }, warnings);
  assert.equal(got.length, 0);
  assert.ok(warnings.some((w) => /multiple vault-skills kind tags/.test(w)));
});

test("markFrontmatter returns { set, addTags }: frontmatter mode writes type, tags mode appends a tag", () => {
  // frontmatter mode — unchanged behavior, wrapped in { set, addTags: [] }
  assert.deepEqual(
    markFrontmatter({ type: "agent", parent: "research" }, { mode: "prefix", prefix: "", key: "vault-skills" }),
    { set: { type: "agent", parent: "[[research]]" }, addTags: [] },
  );
  // tags mode — kind becomes a tag; parent stays a frontmatter field
  assert.deepEqual(
    markFrontmatter({ type: "skill", parent: "research" }, { mode: "prefix", prefix: "", key: "", typeSource: "tags", tagPrefix: "agent/" }),
    { set: { parent: "[[research]]" }, addTags: ["#agent/skill"] },
  );
});

test("applyMark assigns set fields and dedup-appends bare tags into fm.tags", () => {
  const fm1 = { tags: ["existing"] };
  applyMark(fm1, { set: { parent: "[[g]]" }, addTags: ["#agent/skill"] });
  assert.deepEqual(fm1, { tags: ["existing", "agent/skill"], parent: "[[g]]" }, "tag stored without #");

  const fm2 = { tags: ["agent/skill"] };
  applyMark(fm2, { set: {}, addTags: ["#agent/skill"] });
  assert.deepEqual(fm2.tags, ["agent/skill"], "no duplicate");

  const fm3 = {};
  applyMark(fm3, { set: { type: "agent" }, addTags: [] });
  assert.deepEqual(fm3, { type: "agent" }, "frontmatter mode leaves tags untouched");
});
