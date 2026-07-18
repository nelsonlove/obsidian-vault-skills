import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { previewVault, runExport } from "../src/exporter.ts";
import { transformAll } from "../src/transform.ts";

// Minimal stand-in for Obsidian's App (same shape as exporter.test.mjs).
function mockApp(notes) {
  const files = notes.map((n) => ({
    path: n.path,
    basename: n.path.replace(/\.md$/, "").split("/").pop(),
    extension: n.path.split(".").pop(),
  }));
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
  { path: "pol.md", frontmatter: { type: "policy", parent: "[[grants]]" }, content: "---\ntype: policy\n---\n\nGrants policy body." },
  { path: "cmd.md", frontmatter: { type: "command", name: "do-thing" }, content: "---\ntype: command\n---\n\nDo the thing." },
];

const OPTS = (dir) => ({ outputDir: dir, pluginName: "vault-skills" });

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vs-preview-"));
}

test("fresh output dir: everything added, nothing removed", async () => {
  const dir = tmpdir();
  const p = await previewVault(mockApp(SAMPLE), OPTS(dir));
  assert.ok(p.entries.length >= 4, "agents + skill + command emitted");
  assert.ok(p.entries.every((e) => e.status === "added"));
  assert.deepEqual(p.removed, []);
  assert.equal(p.diff.added, p.entries.length);
  assert.equal(p.diff.modified + p.diff.unchanged + p.diff.removed, 0);
});

test("after an export: everything unchanged; preview matches the exported file set", async () => {
  const dir = tmpdir();
  await runExport(mockApp(SAMPLE), OPTS(dir));
  const p = await previewVault(mockApp(SAMPLE), OPTS(dir));
  assert.ok(p.entries.every((e) => e.status === "unchanged"), JSON.stringify(p.entries.map((e) => [e.relOut, e.status])));
  assert.deepEqual(p.removed, []);
  for (const e of p.entries) {
    assert.equal(fs.readFileSync(path.join(dir, e.relOut), "utf8"), e.content, `${e.relOut} preview content = exported content`);
  }
});

test("edited note: exactly that entry is modified, with cachedContent carried", async () => {
  const dir = tmpdir();
  await runExport(mockApp(SAMPLE), OPTS(dir));
  const edited = SAMPLE.map((n) => (n.path === "sweep.md" ? { ...n, content: "---\ntype: skill\n---\n\nSweep v2." } : n));
  const p = await previewVault(mockApp(edited), OPTS(dir));
  const sweep = p.entries.find((e) => e.relOut === "skills/deadline-sweep/SKILL.md");
  assert.equal(sweep.status, "modified");
  assert.match(sweep.content, /Sweep v2\./);
  assert.match(sweep.cachedContent, /Sweep\./);
  assert.equal(p.diff.modified, 1);
  assert.ok(p.entries.filter((e) => e.relOut !== sweep.relOut).every((e) => e.status === "unchanged"));
});

test("dropped note: its file shows as removed; manifest asset entries do not", async () => {
  const dir = tmpdir();
  await runExport(mockApp(SAMPLE), OPTS(dir));
  // Simulate a bundled asset tracked by a previous export alongside the generated files.
  const manifestPath = path.join(dir, ".vault-skills-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.push("skills/deadline-sweep/helper.py");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const without = SAMPLE.filter((n) => n.path !== "sweep.md");
  const p = await previewVault(mockApp(without), OPTS(dir));
  assert.deepEqual(p.removed, ["skills/deadline-sweep/SKILL.md"], "generated file removed; asset ignored");
  assert.equal(p.diff.removed, 1);
});

test("retired static file in the manifest is reported as removed; assets stay excluded", async () => {
  const dir = tmpdir();
  await runExport(mockApp(SAMPLE), OPTS(dir));
  // A previous plugin version exported a static hook file + a bundled asset; neither is
  // regenerated now (STATIC_FILES is empty under tsx). The export would delete both, but
  // only the static one is predictable — the asset might be re-collected.
  const manifestPath = path.join(dir, ".vault-skills-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.push("hooks/hooks.json", "skills/deadline-sweep/helper.py");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const p = await previewVault(mockApp(SAMPLE), OPTS(dir));
  assert.ok(p.removed.includes("hooks/hooks.json"), "retired static reported as removed");
  assert.ok(!p.removed.includes("skills/deadline-sweep/helper.py"), "asset excluded from removal");
});

test("entries carry the Claude Code listing line (name + description)", async () => {
  const p = await previewVault(mockApp(SAMPLE), OPTS(tmpdir()));
  const grants = p.entries.find((e) => e.relOut === "agents/grants.md");
  assert.equal(grants.name, "grants");
  assert.ok(grants.description.length > 0);
  const cmd = p.entries.find((e) => e.relOut === "commands/do-thing.md");
  assert.equal(cmd.name, "do-thing");
  const sweep = p.entries.find((e) => e.relOut === "skills/deadline-sweep/SKILL.md");
  assert.equal(sweep.name, "deadline-sweep");
  assert.match(sweep.description, /\[Grants\]|deadline/i, "skill description present (breadcrumbed)");
});

test("policy placement: lineage injection lands in the parent agent and its subtree", async () => {
  const p = await previewVault(mockApp(SAMPLE), OPTS(tmpdir()));
  const pol = p.policies.find((x) => x.path === "pol.md");
  assert.ok(pol, "resolved policy has a placement entry");
  assert.equal(pol.hard, false);
  assert.deepEqual(pol.agents, ["grants"], "policy attached to grants lands in the grants agent file");
  const grants = p.entries.find((e) => e.relOut === "agents/grants.md");
  assert.match(grants.content, /Grants policy body\./, "placement matches the compiled content");
});

test("hard policy is placed into crosscutting agents that inline it", () => {
  const notes = [
    { path: "root.md", frontmatter: { type: "agent", name: "vault", root: true }, parentPaths: [], body: "Root." },
    { path: "grants.md", frontmatter: { type: "agent", name: "grants" }, parentPaths: ["root.md"], body: "Grants." },
    { path: "hardpol.md", frontmatter: { type: "policy", severity: "hard" }, parentPaths: ["grants.md"], body: "Never delete grant files." },
    { path: "sweeper.md", frontmatter: { type: "agent", name: "sweeper", crosscutting: true }, parentPaths: ["root.md"], body: "Sweeper." },
  ];
  const r = transformAll(notes, { pluginName: "vault-skills" });
  const pol = r.policies.find((p) => p.path === "hardpol.md");
  assert.ok(pol.hard);
  assert.ok(pol.agents.includes("grants"), "lineage placement");
  assert.ok(pol.agents.includes("sweeper"), "hard inline into the crosscutting agent");
});

test("preview entries carry transclusion sources; compiled content is marked", async () => {
  const notes = [
    ...SAMPLE,
    { path: "shared.md", frontmatter: { title: "plain" }, content: "Shared conventions text." },
  ].map((n) => (n.path === "sweep.md"
    ? { ...n, content: "---\ntype: skill\n---\n\nSweep.\n\n![[shared]]" }
    : n));
  const p = await previewVault(mockApp(notes), OPTS(tmpdir()));
  const sweep = p.entries.find((e) => e.relOut === "skills/deadline-sweep/SKILL.md");
  assert.deepEqual(sweep.sources, ["shared.md"], "transcluded note reported as a source");
  assert.match(sweep.content, /<!-- transcluded from: shared\.md -->\nShared conventions text\.\n<!-- end transclusion: shared\.md -->/);
  const grants = p.entries.find((e) => e.relOut === "agents/grants.md");
  assert.equal(grants.sources, undefined, "no sources field without transclusions");
  assert.match(grants.content, /<!-- policy: pol\.md -->\nGrants policy body\./, "injected policy names its source note");
});

test("unresolved policy gets no placement entry", () => {
  const notes = [
    { path: "root.md", frontmatter: { type: "agent", name: "vault", root: true }, parentPaths: [], body: "Root." },
    { path: "orphan-pol.md", frontmatter: { type: "policy" }, parentPaths: ["missing.md"], body: "Orphan." },
  ];
  const r = transformAll(notes, { pluginName: "vault-skills" });
  assert.equal(r.policies.length, 0);
  assert.ok(r.errors.some((e) => e.includes("orphan-pol.md")));
});
