import { test } from "node:test";
import assert from "node:assert/strict";
import { transformAll, toYaml, slug } from "../src/transform.ts";

const OPTS = { pluginName: "vault-skills", synthesizeRoot: true };
const note = (path, fm, parentPaths = [], body = "body") => ({ path, frontmatter: fm, body, parentPaths });
const find = (gen, relOut) => gen.find((g) => g.relOut === relOut);

test("root → area → category cascade wired by parent; Agent tool appended", () => {
  const { generated, errors } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("area.md", { type: "agent", name: "research", label: "Education & research", tools: ["Read"] }, ["root.md"]),
    note("cat.md", { type: "agent", name: "grants", label: "Grants & funding" }, ["area.md"]),
  ], OPTS);
  assert.equal(errors.length, 0);
  const root = find(generated, "agents/vault.md");
  const area = find(generated, "agents/research.md");
  assert.match(root.content, /## Vault routing/);
  assert.match(root.content, /- `vault-skills:research` — Education & research/);
  assert.match(area.content, /tools: \[Read, Agent\]/);
  assert.match(area.content, /- `vault-skills:grants` — Grants & funding/);
});

test("skill ownership via parent → preloaded, namespaced, into the owning agent", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("grants.md", { type: "agent", name: "grants" }, ["root.md"]),
    note("sweep.md", { type: "skill", name: "deadline-sweep" }, ["grants.md"]),
  ], OPTS);
  const grants = find(generated, "agents/grants.md");
  assert.match(grants.content, /skills:\n\s+- "vault-skills:deadline-sweep"/);
  assert.ok(find(generated, "skills/deadline-sweep/SKILL.md"));
});

test("shared skill at level 0 (no parent) is owned by the root", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("callout.md", { type: "skill", name: "add-callout" }, []),
  ], OPTS);
  assert.match(find(generated, "agents/vault.md").content, /skills:\n\s+- "vault-skills:add-callout"/);
});

test("agent that owns skills gets the Skill tool when tools are explicitly listed", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("grants.md", { type: "agent", name: "grants", tools: ["Read"] }, ["root.md"]),
    note("sweep.md", { type: "skill", name: "sweep" }, ["grants.md"]),
  ], OPTS);
  assert.match(find(generated, "agents/grants.md").content, /tools: \[Read, Skill\]/);
});

test("vault path is baked into every agent when provided", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
  ], { pluginName: "vault-skills", synthesizeRoot: true, vaultPath: "/Users/x/obsidian" });
  const root = find(generated, "agents/vault.md");
  assert.match(root.content, /## Vault access/);
  assert.match(root.content, /`\/Users\/x\/obsidian`/);
});

test("synthesized root when none is declared", () => {
  const { generated } = transformAll([
    note("area.md", { type: "agent", name: "research", label: "Research" }, []),
  ], OPTS);
  const root = find(generated, "agents/vault.md");
  assert.ok(root, "synthetic vault root");
  assert.match(root.content, /- `vault-skills:research` — Research/);
});

test("strict single parent: a list of parents is an error, node not rendered", () => {
  const { generated, errors } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("a.md", { type: "agent", name: "a" }, ["root.md"]),
    note("bad.md", { type: "skill", name: "bad" }, ["root.md", "a.md"]),
  ], OPTS);
  assert.ok(errors.some((e) => /multiple parents/.test(e)));
  assert.equal(find(generated, "skills/bad/SKILL.md"), undefined);
});

test("unresolved parent is an error", () => {
  const { errors } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("orphan.md", { type: "skill", name: "orphan" }, ["missing.md"]),
  ], OPTS);
  assert.ok(errors.some((e) => /unresolved parent/.test(e)));
});

test("parent that is a skill is an error", () => {
  const { errors } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("s.md", { type: "skill", name: "s" }, ["root.md"]),
    note("bad.md", { type: "agent", name: "bad" }, ["s.md"]),
  ], OPTS);
  assert.ok(errors.some((e) => /parent is not an agent/.test(e)));
});

test("cycle is detected", () => {
  const { errors } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("a.md", { type: "agent", name: "a" }, ["b.md"]),
    note("b.md", { type: "agent", name: "b" }, ["a.md"]),
  ], OPTS);
  assert.ok(errors.some((e) => /broken parent chain|does not reach/.test(e)));
});

test("depth beyond level 4 warns (nesting cap)", () => {
  const notes = [note("root.md", { type: "agent", name: "vault", root: true })];
  let prev = "root.md";
  for (let i = 1; i <= 5; i++) { const p = `l${i}.md`; notes.push(note(p, { type: "agent", name: `l${i}` }, [prev])); prev = p; }
  const { warnings } = transformAll(notes, OPTS);
  assert.ok(warnings.some((w) => /exceeds the depth-5/.test(w)));
});

test("global policy (no parent) is injected into every agent", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("research.md", { type: "agent", name: "research" }, ["root.md"]),
    note("pol.md", { type: "policy", name: "global-pol" }, [], "GLOBAL-POLICY-TEXT"),
  ], OPTS);
  assert.match(find(generated, "agents/vault.md").content, /GLOBAL-POLICY-TEXT/);
  assert.match(find(generated, "agents/research.md").content, /GLOBAL-POLICY-TEXT/);
});

test("scoped policy (parent) applies to that agent's subtree only", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("research.md", { type: "agent", name: "research" }, ["root.md"]),
    note("grants.md", { type: "agent", name: "grants" }, ["research.md"]),
    note("other.md", { type: "agent", name: "other" }, ["root.md"]),
    note("pol.md", { type: "policy", name: "research-pol" }, ["research.md"], "RESEARCH-ONLY-POLICY"),
  ], OPTS);
  assert.match(find(generated, "agents/research.md").content, /RESEARCH-ONLY-POLICY/, "on the scope agent");
  assert.match(find(generated, "agents/grants.md").content, /RESEARCH-ONLY-POLICY/, "on a descendant");
  assert.doesNotMatch(find(generated, "agents/other.md").content, /RESEARCH-ONLY-POLICY/, "not on a sibling subtree");
  assert.doesNotMatch(find(generated, "agents/vault.md").content, /RESEARCH-ONLY-POLICY/, "not on the root");
});

test("policy whose parent is a skill is an error", () => {
  const { errors } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("s.md", { type: "skill", name: "s" }, ["root.md"]),
    note("pol.md", { type: "policy", name: "p" }, ["s.md"], "x"),
  ], OPTS);
  assert.ok(errors.some((e) => /policy parent is not an agent/.test(e)));
});

test("crosscutting agent gets a scope-policy index; global + own-lineage policies excluded", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("legal.md", { type: "agent", name: "legal", label: "Legal" }, ["root.md"]),
    note("capture.md", { type: "agent", name: "capture" }, ["root.md"]),
    note("triager.md", { type: "agent", name: "triager", crosscutting: true }, ["capture.md"]),
    note("gp.md", { type: "policy", name: "gp" }, [], "GLOBAL-POLICY"),
    note("lp.md", { type: "policy" }, ["legal.md"], "LEGAL-SOFT-POLICY"),
    note("cp.md", { type: "policy" }, ["capture.md"], "CAPTURE-POLICY"),
  ], OPTS);
  const triager = find(generated, "agents/triager.md");
  assert.match(triager.content, /## Scope policies/);
  assert.match(triager.content, /- Legal \(`vault-skills:legal`\): lp \(`lp\.md`\)/, "scoped policy listed as title + discovered path");
  assert.doesNotMatch(triager.content, /LEGAL-SOFT-POLICY/, "soft policy is a pointer, not inlined");
  assert.equal(triager.content.match(/GLOBAL-POLICY/g).length, 1, "global policy appears only via own injection, not the index");
  assert.doesNotMatch(triager.content, /Scope policies[\s\S]*cp\.md/, "own-lineage policy not in the index");
  const legal = find(generated, "agents/legal.md");
  assert.doesNotMatch(legal.content, /## Scope policies/, "non-crosscutting agents don't get the index");
});

test("severity: hard policy is inlined in full into crosscutting agents", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("legal.md", { type: "agent", name: "legal", label: "Legal" }, ["root.md"]),
    note("triager.md", { type: "agent", name: "triager", crosscutting: true }, ["root.md"]),
    note("hp.md", { type: "policy", severity: "hard" }, ["legal.md"], "NEVER-ALTER-EVIDENCE"),
  ], OPTS);
  const triager = find(generated, "agents/triager.md");
  assert.match(triager.content, /hp \(hard — included in full below\)/, "index marks it hard");
  assert.match(triager.content, /\*\*Hard policy — binds when working in Legal:\*\*\n\nNEVER-ALTER-EVIDENCE/);
  assert.doesNotMatch(find(generated, "agents/vault.md").content, /NEVER-ALTER-EVIDENCE/, "root untouched");
});

test("transform exposes a structured tree (parent/children/skills)", () => {
  const { tree } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("research.md", { type: "agent", name: "research" }, ["root.md"]),
    note("sweep.md", { type: "skill", name: "sweep" }, ["research.md"]),
  ], OPTS);
  const root = tree.find((n) => n.name === "vault");
  const research = tree.find((n) => n.name === "research");
  assert.equal(root.parent, null);
  assert.deepEqual(root.children, ["research"]);
  assert.deepEqual(research.skills, ["sweep"]);
});

test("toYaml: quotes leading-[ and colon arrays; bare names stay plain", () => {
  assert.equal(toYaml({ name: "grants" }), "---\nname: grants\n---");
  assert.match(toYaml({ description: "[X] y" }), /description: "\[X\] y"/);
  assert.match(toYaml({ skills: ["vault-skills:x"] }), /skills:\n\s+- "vault-skills:x"/);
});

test("slug normalizes ampersands and punctuation", () => {
  assert.equal(slug("Grants & Funding!"), "grants-and-funding");
});

test("notes without type: skill|agent are ignored", () => {
  const { generated } = transformAll([note("n.md", { title: "x" }, [])], { pluginName: "vault-skills", synthesizeRoot: false });
  assert.equal(generated.length, 0);
});

test("crosscutting agent fans into scope agents as a specialist, not a vertical lane", () => {
  const { generated, tree } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("area.md", { type: "agent", name: "research", tools: ["Read"] }, ["root.md"]),
    note("cat.md", { type: "agent", name: "grants", tools: ["Read"] }, ["area.md"]),
    note("surv.md", { type: "agent", name: "surveyor", crosscutting: true, slot: ".00", tools: ["Read"] }, ["root.md"]),
  ], OPTS);
  const root = find(generated, "agents/vault.md");
  const grants = find(generated, "agents/grants.md");
  const surveyor = find(generated, "agents/surveyor.md");
  assert.doesNotMatch(root.content, /`vault-skills:surveyor` — /, "not a vertical lane");
  assert.match(grants.content, /## Cross-cutting specialists/);
  assert.match(grants.content, /- `vault-skills:surveyor` \(\.00\)/, "listed as a specialist with its slot");
  assert.match(grants.content, /tools: \[Read, Agent\]/, "leaf scope agent gets the Agent tool to delegate");
  assert.doesNotMatch(surveyor.content, /## Cross-cutting specialists/, "a specialist doesn't itself get the block");
  assert.equal(tree.find((n) => n.name === "surveyor").crosscutting, true);
});

test("skill passthrough: documented SKILL.md fields are emitted verbatim", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("s.md", {
      type: "skill", name: "wrap-up",
      "user-invocable": false, "disable-model-invocation": true,
      "allowed-tools": ["Bash", "Read"], context: "fork", "argument-hint": "[scope]",
    }, []),
  ], OPTS);
  const skill = find(generated, "skills/wrap-up/SKILL.md");
  assert.match(skill.content, /user-invocable: false/);
  assert.match(skill.content, /disable-model-invocation: true/);
  assert.match(skill.content, /allowed-tools: \[Bash, Read\]/);
  assert.match(skill.content, /context: fork/);
  assert.match(skill.content, /argument-hint: "\[scope\]"/);
});

test("skill passthrough: non-allowlisted keys (tags, aliases, …) are not emitted", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("s.md", { type: "skill", name: "s", tags: ["jd/skill"], aliases: ["x"], created: "2026-01-01" }, []),
  ], OPTS);
  const skill = find(generated, "skills/s/SKILL.md");
  assert.doesNotMatch(skill.content, /tags:/);
  assert.doesNotMatch(skill.content, /aliases:/);
  assert.doesNotMatch(skill.content, /created:/);
});

test("skill passthrough: nested values are dropped with a warning, not [object Object]", () => {
  const { generated, warnings } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("s.md", { type: "skill", name: "s", arguments: { scope: "the scope" }, context: "fork" }, []),
  ], OPTS);
  const skill = find(generated, "skills/s/SKILL.md");
  assert.doesNotMatch(skill.content, /\[object Object\]/);
  assert.doesNotMatch(skill.content, /arguments:/);
  assert.match(skill.content, /context: fork/, "scalar sibling still passes through");
  assert.ok(warnings.some((w) => /passthrough field `arguments` has a nested value/.test(w)));
});

test("toYaml: comma inside an array item forces block style with quoting", () => {
  const y = toYaml({ "allowed-tools": ["Bash(ls, cat)", "Read"] });
  assert.match(y, /allowed-tools:\n\s+- "Bash\(ls, cat\)"\n\s+- Read/);
});
