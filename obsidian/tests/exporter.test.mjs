import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runExport, collectNotes, analyzeVault, markFrontmatter, readPluginVersion } from "../src/exporter.ts";

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

test("analyzeVault returns tree + counts + no errors for a valid vault", async () => {
  const a = await analyzeVault(mockApp(SAMPLE));
  assert.equal(a.errors.length, 0);
  assert.equal(a.counts.agents, 2); // vault root + grants
  assert.equal(a.counts.skills, 1);
  assert.ok(a.tree.find((n) => n.name === "grants"), "tree includes grants");
});

test("markFrontmatter honors the field mode", () => {
  const input = { type: "agent", parent: "research" };
  assert.deepEqual(markFrontmatter(input, { mode: "prefix", prefix: "", key: "vault-skills" }),
    { set: { type: "agent", parent: "[[research]]" }, addTags: [] });
  assert.deepEqual(markFrontmatter(input, { mode: "prefix", prefix: "vs-", key: "" }),
    { set: { "vs-type": "agent", "vs-parent": "[[research]]" }, addTags: [] });
  assert.deepEqual(markFrontmatter(input, { mode: "nested", prefix: "", key: "vault-skills" }),
    { set: { "vault-skills": { type: "agent", parent: "[[research]]" } }, addTags: [] });
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

test("runExport bundles supporting files from the parallel assets tree", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-assets-out-"));
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vs-assets-root-"));
  // parallel folder for sweep.md → <root>/sweep/
  fs.mkdirSync(path.join(assetsRoot, "sweep", "bin"), { recursive: true });
  fs.writeFileSync(path.join(assetsRoot, "sweep", "bin", "sweep.py"), "print('hi')\n");
  fs.writeFileSync(path.join(assetsRoot, "sweep", "SKILL.md"), "must not clobber");

  const summary = await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills", assetsRoot });
  assert.equal(summary.assets, 1);
  assert.ok(summary.warnings.some((w) => /would overwrite the generated SKILL\.md/.test(w)));
  const bundled = path.join(out, "skills/deadline-sweep/bin/sweep.py");
  assert.ok(fs.existsSync(bundled), "asset bundled next to SKILL.md");
  assert.match(fs.readFileSync(path.join(out, "skills/deadline-sweep/SKILL.md"), "utf8"),
    /generated by obsidian-vault-skills/, "generated SKILL.md not clobbered");
  const manifest = JSON.parse(fs.readFileSync(path.join(out, ".vault-skills-manifest.json"), "utf8"));
  assert.ok(manifest.files.includes("skills/deadline-sweep/bin/sweep.py"), "asset tracked in manifest");

  // re-export without the assets tree → the bundled asset is removed as stale
  await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills" });
  assert.ok(!fs.existsSync(bundled), "stale asset removed on next export");

  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(assetsRoot, { recursive: true, force: true });
});

test("runExport stamps an explicit version into plugin.json (create + update)", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-rel-"));
  await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills", version: "1.2.0" });
  const manifestPath = path.join(out, ".claude-plugin/plugin.json");
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).version, "1.2.0");
  assert.equal(readPluginVersion(out), "1.2.0");

  // plain export leaves the version alone; release export updates it in place
  await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills" });
  assert.equal(readPluginVersion(out), "1.2.0");
  await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills", version: "1.3.0" });
  const updated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(updated.version, "1.3.0");
  assert.equal(updated.name, "vault-skills", "existing manifest fields preserved");

  fs.rmSync(out, { recursive: true, force: true });
});

test("collectNotes carries passthrough fields (prefix mode applies the prefix)", async () => {
  const notes = [
    { path: "s.md", frontmatter: { "vs-type": "skill", "vs-name": "s", "vs-user-invocable": false }, content: "body" },
  ];
  const got = await collectNotes(mockApp(notes), { mode: "prefix", prefix: "vs-", key: "" });
  assert.equal(got[0].frontmatter["user-invocable"], false);
});

test("runExport degrades to a warning when a supporting-files dir is unreadable", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-eperm-out-"));
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vs-eperm-root-"));
  const locked = path.join(assetsRoot, "sweep", "secret");
  fs.mkdirSync(locked, { recursive: true });
  fs.writeFileSync(path.join(locked, "x.txt"), "x");
  fs.chmodSync(locked, 0o000);
  try {
    const summary = await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills", assetsRoot });
    assert.equal(summary.errors.length, 0);
    assert.ok(summary.warnings.some((w) => /could not read supporting files/.test(w)));
    assert.ok(fs.existsSync(path.join(out, "skills/deadline-sweep/SKILL.md")), "export still completed");
  } finally {
    fs.chmodSync(locked, 0o755);
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(assetsRoot, { recursive: true, force: true });
  }
});

test("runExport keeps the previously exported copy of an asset that fails to materialize", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-retain-out-"));
  const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vs-retain-root-"));
  const dir = path.join(assetsRoot, "sweep", "bin");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.py"), "v1");
  await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills", assetsRoot });
  const bundled = path.join(out, "skills/deadline-sweep/bin/tool.py");
  assert.ok(fs.existsSync(bundled));

  // Evict: replace the real file with an iCloud placeholder that never materializes.
  fs.rmSync(path.join(dir, "tool.py"));
  fs.writeFileSync(path.join(dir, ".tool.py.icloud"), "placeholder");
  const summary = await runExport(mockApp(SAMPLE), {
    outputDir: out, pluginName: "vault-skills", assetsRoot,
    assetOptions: { download: () => {}, pollMs: 1, timeoutMs: 10 },
  });
  assert.ok(fs.existsSync(bundled), "previous copy NOT deleted by stale cleanup");
  assert.equal(fs.readFileSync(bundled, "utf8"), "v1");
  assert.ok(summary.warnings.some((w) => /kept the previously exported copy/.test(w)));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, ".vault-skills-manifest.json"), "utf8"));
  assert.ok(manifest.files.includes("skills/deadline-sweep/bin/tool.py"), "retained file still in manifest");

  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(assetsRoot, { recursive: true, force: true });
});

test("release export refuses to clobber an unparseable plugin.json", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-badjson-"));
  fs.mkdirSync(path.join(out, ".claude-plugin"), { recursive: true });
  const manifestPath = path.join(out, ".claude-plugin/plugin.json");
  fs.writeFileSync(manifestPath, '{"name": "x", "description": "keep me",}'); // trailing comma
  await assert.rejects(
    () => runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills", version: "1.0.0" }),
    /not valid JSON/,
  );
  assert.match(fs.readFileSync(manifestPath, "utf8"), /keep me/, "original file untouched");
  fs.rmSync(out, { recursive: true, force: true });
});
