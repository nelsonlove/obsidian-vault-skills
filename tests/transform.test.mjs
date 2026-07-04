import { test } from "node:test";
import assert from "node:assert/strict";
import { transformAll, deriveFromPath, resolveScope, toYaml, slug } from "../src/transform.ts";

const find = (gen, relOut) => gen.find((g) => g.relOut === relOut);

test("universal skill: 00 prefix, [System] breadcrumb, quoted description", () => {
  const { generated } = transformAll([{
    path: "00-09 System/03 LLMs & agents/add-callout.md",
    frontmatter: { type: "skill", description: "Insert a callout." },
    body: "# Add a callout\nbody",
  }]);
  const s = find(generated, "skills/00-add-callout/SKILL.md");
  assert.ok(s, "skill generated at expected path");
  assert.match(s.content, /description: "\[System\] Insert a callout\."/);
});

test("category agent: category code prefix + area › category breadcrumb", () => {
  const { generated } = transformAll([{
    path: "50-59 Education & research/56 Grants & funding/grant-deadline-sweep.md",
    frontmatter: { type: "agent", description: "Sweep grant deadlines.", tools: ["Read", "Grep"] },
    body: "system prompt",
  }]);
  const a = find(generated, "agents/56-grant-deadline-sweep.md");
  assert.ok(a);
  assert.match(a.content, /description: "\[Education & research › Grants & funding\] /);
});

test("X0 management folder collapses to area scope", () => {
  const { area, category } = deriveFromPath(
    "50-59 Education & research/50 Management of 50-59 Education & research/research-router.md");
  assert.equal(resolveScope({}, area, category), "area");
});

test("delegation: Agent tool auto-added + wikilink resolves to generated name", () => {
  const { generated, warnings } = transformAll([
    {
      path: "50-59 Education & research/50 Management of 50-59 Education & research/research-router.md",
      frontmatter: { type: "agent", description: "Area router.", tools: ["Read", "Grep"], "delegates-to": ["[[grant-deadline-sweep]]"] },
      body: "router",
    },
    {
      path: "50-59 Education & research/56 Grants & funding/grant-deadline-sweep.md",
      frontmatter: { type: "agent", description: "Sweep." },
      body: "sweep",
    },
  ]);
  const router = find(generated, "agents/50-research-router.md");
  assert.ok(router);
  assert.match(router.content, /tools: \[Read, Grep, Agent\]/, "Agent tool appended");
  assert.match(router.content, /`56-grant-deadline-sweep`/, "delegate resolved to generated name");
  assert.equal(warnings.length, 0);
});

test("unresolved delegate (points at a skill) produces a warning", () => {
  const { warnings } = transformAll([
    {
      path: "90-99 Vault testbed/90 Management of 90-99 Vault testbed/router.md",
      frontmatter: { type: "agent", description: "r", "delegates-to": ["[[echo-shape]]"] },
      body: "r",
    },
    {
      path: "90-99 Vault testbed/95 Testbed skills/echo-shape.md",
      frontmatter: { type: "skill", description: "e" },
      body: "e",
    },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unresolved delegate/);
});

test("toYaml quotes strings with YAML-significant leading chars; plain names stay bare", () => {
  assert.equal(toYaml({ name: "56-x" }), '---\nname: 56-x\n---');
  assert.match(toYaml({ description: "[X] y: z" }), /description: "\[X\] y: z"/);
});

test("slug normalizes ampersands and punctuation", () => {
  assert.equal(slug("Grants & Funding!"), "grants-and-funding");
});

test("notes without type: skill|agent are ignored", () => {
  const { generated } = transformAll([
    { path: "10-19 Personal/11 x/note.md", frontmatter: { title: "just a note" }, body: "x" },
  ]);
  assert.equal(generated.length, 0);
});
