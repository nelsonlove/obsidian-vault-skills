import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runExport, collectNotes } from "../src/exporter.ts";

// Minimal stand-in for Obsidian's App, including wikilink resolution by basename.
function mockApp(notes) {
  const files = notes.map((n) => ({ path: n.path, basename: n.path.replace(/\.md$/, "").split("/").pop() }));
  const byPath = new Map(notes.map((n) => [n.path, n]));
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (f) => byPath.get(f.path).content,
    },
    metadataCache: {
      getFileCache: (f) => ({ frontmatter: byPath.get(f.path).frontmatter }),
      getFirstLinkpathDest: (lp) => files.find((f) => f.basename === lp || f.path === lp || f.path === `${lp}.md`) ?? null,
    },
  };
}

const SAMPLE = [
  { path: "root.md", frontmatter: { type: "agent", name: "vault", root: true }, content: "---\ntype: agent\n---\n\nRoot." },
  { path: "grants.md", frontmatter: { type: "agent", name: "grants", parent: "[[root]]" }, content: "---\ntype: agent\n---\n\nGrants agent." },
  { path: "sweep.md", frontmatter: { type: "skill", name: "deadline-sweep", parent: "[[grants]]" }, content: "---\ntype: skill\n---\n\nSweep." },
  { path: "note.md", frontmatter: { title: "plain" }, content: "not a skill" },
];

test("collectNotes filters to skill/agent notes, strips frontmatter, resolves parents", async () => {
  const notes = await collectNotes(mockApp(SAMPLE));
  assert.equal(notes.length, 3);
  assert.ok(notes.every((n) => !n.body.startsWith("---")), "frontmatter stripped");
  const sweep = notes.find((n) => n.path === "sweep.md");
  assert.deepEqual(sweep.parentPaths, ["grants.md"], "parent wikilink resolved to path");
});

test("prefix field mode reads vs-* fields and ignores bare `type`", async () => {
  const notes = [
    { path: "root.md", frontmatter: { "vs-type": "agent", "vs-name": "vault", "vs-root": true }, content: "body" },
    { path: "grants.md", frontmatter: { "vs-type": "agent", "vs-name": "grants", "vs-parent": "[[root]]" }, content: "body" },
    { path: "plain.md", frontmatter: { type: "agent" }, content: "body" }, // bare type ignored in prefix mode
  ];
  const got = await collectNotes(mockApp(notes), { mode: "prefix", prefix: "vs-", key: "" });
  assert.equal(got.length, 2);
  const grants = got.find((n) => n.path === "grants.md");
  assert.equal(grants.frontmatter.type, "agent");
  assert.equal(grants.frontmatter.name, "grants");
  assert.deepEqual(grants.parentPaths, ["root.md"]);
});

test("nested field mode reads fields under the configured key", async () => {
  const notes = [
    { path: "root.md", frontmatter: { "vault-skills": { type: "agent", name: "vault", root: true } }, content: "body" },
    { path: "grants.md", frontmatter: { "vault-skills": { type: "agent", name: "grants", parent: "[[root]]" } }, content: "body" },
  ];
  const got = await collectNotes(mockApp(notes), { mode: "nested", prefix: "", key: "vault-skills" });
  assert.equal(got.length, 2);
  const grants = got.find((n) => n.path === "grants.md");
  assert.equal(grants.frontmatter.type, "agent");
  assert.deepEqual(grants.parentPaths, ["root.md"]);
});

test("runExport writes the tree: root, child agent, owned skill, plugin.json, manifest", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-exp-"));
  const summary = await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills" });

  assert.equal(summary.skills, 1);
  assert.equal(summary.agents, 2, "root + grants");
  assert.equal(summary.errors.length, 0);
  assert.ok(fs.existsSync(path.join(out, "agents/vault.md")));
  assert.ok(fs.existsSync(path.join(out, "agents/grants.md")));
  assert.ok(fs.existsSync(path.join(out, "skills/deadline-sweep/SKILL.md")));
  assert.ok(fs.existsSync(path.join(out, ".claude-plugin/plugin.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, ".vault-skills-manifest.json"), "utf8"));
  assert.equal(manifest.count, 3);
  // grants agent owns the skill via preload
  assert.match(fs.readFileSync(path.join(out, "agents/grants.md"), "utf8"), /vault-skills:deadline-sweep/);

  fs.rmSync(out, { recursive: true, force: true });
});

test("runExport removes stale artifacts when a note disappears", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-stale-"));
  await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills" });
  assert.ok(fs.existsSync(path.join(out, "skills/deadline-sweep/SKILL.md")));

  // re-export without the skill note
  await runExport(mockApp([SAMPLE[0], SAMPLE[1]]), { outputDir: out, pluginName: "vault-skills" });
  assert.ok(!fs.existsSync(path.join(out, "skills/deadline-sweep/SKILL.md")), "stale skill removed");
  assert.ok(fs.existsSync(path.join(out, "agents/grants.md")), "kept agent remains");

  fs.rmSync(out, { recursive: true, force: true });
});
