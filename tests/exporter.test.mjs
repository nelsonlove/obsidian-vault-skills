import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runExport, collectNotes } from "../src/exporter.ts";
import { ensureSymlink } from "../src/paths.ts";

// Minimal stand-in for Obsidian's App: just what the exporter reads.
function mockApp(notes) {
  const files = notes.map((n) => ({ path: n.path }));
  const byPath = new Map(notes.map((n) => [n.path, n]));
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (f) => byPath.get(f.path).content,
    },
    metadataCache: {
      getFileCache: (f) => ({ frontmatter: byPath.get(f.path).frontmatter }),
    },
  };
}

const SAMPLE = [
  {
    path: "00-09 System/03 LLMs & agents/add-callout.md",
    frontmatter: { type: "skill", description: "Insert a callout." },
    content: "---\ntype: skill\ndescription: Insert a callout.\n---\n\n# Add a callout\nBody.",
  },
  {
    path: "50-59 Education & research/56 Grants & funding/grant-deadline-sweep.md",
    frontmatter: { type: "agent", description: "Sweep grant deadlines.", tools: ["Read", "Grep"] },
    content: "---\ntype: agent\n---\n\nSystem prompt.",
  },
  { path: "10-19 Personal/11 x/not-a-skill.md", frontmatter: { title: "plain" }, content: "nope" },
];

test("collectNotes filters to skill/agent notes and strips frontmatter", async () => {
  const notes = await collectNotes(mockApp(SAMPLE));
  assert.equal(notes.length, 2);
  assert.ok(notes.every((n) => !n.body.startsWith("---")), "frontmatter stripped from bodies");
});

test("runExport writes skills, agents, plugin.json and manifest", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-exp-"));
  const summary = await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills" });

  assert.equal(summary.skills, 1);
  assert.equal(summary.agents, 1);
  assert.ok(fs.existsSync(path.join(out, "skills/00-add-callout/SKILL.md")));
  assert.ok(fs.existsSync(path.join(out, "agents/56-grant-deadline-sweep.md")));
  assert.ok(fs.existsSync(path.join(out, ".claude-plugin/plugin.json")), "plugin.json created");
  const manifest = JSON.parse(fs.readFileSync(path.join(out, ".vault-skills-manifest.json"), "utf8"));
  assert.equal(manifest.count, 2);

  fs.rmSync(out, { recursive: true, force: true });
});

test("runExport removes stale artifacts when a note disappears", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vs-stale-"));
  await runExport(mockApp(SAMPLE), { outputDir: out, pluginName: "vault-skills" });
  assert.ok(fs.existsSync(path.join(out, "agents/56-grant-deadline-sweep.md")));

  // Re-export without the agent note.
  await runExport(mockApp([SAMPLE[0]]), { outputDir: out, pluginName: "vault-skills" });
  assert.ok(!fs.existsSync(path.join(out, "agents/56-grant-deadline-sweep.md")), "stale agent removed");
  assert.ok(fs.existsSync(path.join(out, "skills/00-add-callout/SKILL.md")), "kept skill remains");

  fs.rmSync(out, { recursive: true, force: true });
});

test("ensureSymlink creates the link and is idempotent", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vs-link-"));
  const target = path.join(base, "target");
  const link = path.join(base, "skills", "vault-skills");
  fs.mkdirSync(target, { recursive: true });

  assert.equal(ensureSymlink(target, link).status, "created");
  assert.equal(fs.readlinkSync(link) && fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(ensureSymlink(target, link).status, "already");

  fs.rmSync(base, { recursive: true, force: true });
});
