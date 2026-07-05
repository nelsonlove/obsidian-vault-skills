import { test } from "node:test";
import assert from "node:assert/strict";
import { transformAll, deriveFromPath, resolveScope, toYaml, slug } from "../src/transform.ts";

const OPTS = { pluginName: "vault-skills", synthesizeRoot: false };
const find = (gen, relOut) => gen.find((g) => g.relOut === relOut);

test("universal skill: 00 prefix, [System] breadcrumb, quoted description", () => {
  const { generated } = transformAll([{
    path: "00-09 System/03 LLMs & agents/add-callout.md",
    frontmatter: { type: "skill", description: "Insert a callout." },
    body: "# Add a callout\nbody",
  }], OPTS);
  const s = find(generated, "skills/00-add-callout/SKILL.md");
  assert.ok(s);
  assert.match(s.content, /description: "\[System\] Insert a callout\."/);
});

test("category agent: prefix + breadcrumb", () => {
  const { generated } = transformAll([{
    path: "50-59 Education & research/56 Grants & funding/grant-deadline-sweep.md",
    frontmatter: { type: "agent", description: "Sweep grant deadlines.", tools: ["Read", "Grep"] },
    body: "system prompt",
  }], OPTS);
  const a = find(generated, "agents/56-grant-deadline-sweep.md");
  assert.ok(a);
  assert.match(a.content, /description: "\[Education & research › Grants & funding\] /);
});

test("X0 management folder collapses to area scope", () => {
  const { area, category } = deriveFromPath(
    "50-59 Education & research/50 Management of 50-59 Education & research/research-router.md");
  assert.equal(resolveScope({}, area, category), "area");
});

test("skill ownership: category agent preloads its category skill via skills:", () => {
  const { generated, warnings } = transformAll([
    {
      path: "50-59 Education & research/56 Grants & funding/grants.md",
      frontmatter: { type: "agent", name: "grants", description: "Grants agent.", tools: ["Read"] },
      body: "grants agent",
    },
    {
      path: "50-59 Education & research/56 Grants & funding/deadline-sweep.md",
      frontmatter: { type: "skill", name: "deadline-sweep", description: "Sweep deadlines." },
      body: "sweep",
    },
  ], OPTS);
  const agent = find(generated, "agents/56-grants.md");
  assert.ok(agent);
  assert.match(agent.content, /skills:\n\s+- "vault-skills:56-deadline-sweep"/, "owned skill preloaded, namespaced");
  assert.equal(warnings.filter((w) => w.includes("no owning agent")).length, 0);
});

test("auto-cascade: root → area agents → category agents, with Agent tool added when tools listed", () => {
  const { generated } = transformAll([
    { path: "00-09 System/03 LLMs & agents/vault.md", frontmatter: { type: "agent", name: "vault", description: "Root." }, body: "root" },
    { path: "50-59 Education & research/50 Management of 50-59 Education & research/research.md", frontmatter: { type: "agent", name: "research", description: "Area.", tools: ["Read"] }, body: "area" },
    { path: "50-59 Education & research/56 Grants & funding/grants.md", frontmatter: { type: "agent", name: "grants", description: "Cat." }, body: "cat" },
  ], OPTS);

  const root = find(generated, "agents/00-vault.md");
  const area = find(generated, "agents/50-research.md");
  assert.match(root.content, /## Vault routing/);
  assert.match(root.content, /- `50-research` — Education & research/, "root delegates to area agent");
  assert.doesNotMatch(root.content, /^tools:/m, "authored root has no tools -> inherits all (incl. Agent)");
  assert.match(area.content, /tools: \[Read, Agent\]/, "Agent appended to area agent's listed tools");
  assert.match(area.content, /- `56-grants` — Grants & funding/, "area delegates to category agent");
});

test("synthesizeRoot creates a 00-vault agent when the vault has none", () => {
  const { generated } = transformAll([
    { path: "50-59 Education & research/50 Management of 50-59 Education & research/research.md", frontmatter: { type: "agent", name: "research", description: "Area." }, body: "area" },
  ], { pluginName: "vault-skills", synthesizeRoot: true });
  const root = find(generated, "agents/00-vault.md");
  assert.ok(root, "synthetic root generated");
  assert.match(root.content, /- `50-research` — Education & research/);
});

test("manual delegates-to still works and merges with auto-wiring", () => {
  const { generated, warnings } = transformAll([
    { path: "90-99 Vault testbed/90 Management of 90-99 Vault testbed/r.md", frontmatter: { type: "agent", name: "r", description: "x", "delegates-to": ["[[echo]]"] }, body: "r" },
    { path: "90-99 Vault testbed/95 Testbed skills/echo.md", frontmatter: { type: "skill", name: "echo", description: "e" }, body: "e" },
  ], OPTS);
  // echo is a skill (not an agent) -> unresolved manual delegate warning
  assert.ok(warnings.some((w) => /unresolved delegate/.test(w)));
});

test("toYaml: quotes leading-[ strings; bare names stay plain; colon arrays become block lists", () => {
  assert.equal(toYaml({ name: "56-x" }), "---\nname: 56-x\n---");
  assert.match(toYaml({ description: "[X] y" }), /description: "\[X\] y"/);
  assert.match(toYaml({ skills: ["vault-skills:56-x"] }), /skills:\n\s+- "vault-skills:56-x"/);
  assert.match(toYaml({ tools: ["Read", "Grep"] }), /tools: \[Read, Grep\]/);
});

test("slug normalizes ampersands and punctuation", () => {
  assert.equal(slug("Grants & Funding!"), "grants-and-funding");
});

test("notes without type: skill|agent are ignored", () => {
  const { generated } = transformAll([
    { path: "10-19 Personal/11 x/note.md", frontmatter: { title: "just a note" }, body: "x" },
  ], OPTS);
  assert.equal(generated.length, 0);
});
