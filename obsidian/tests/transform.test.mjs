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

test("command note emits commands/<name>.md — flat, no parent needed, body is the template", () => {
  const { generated, errors } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("ps.md", { type: "command", name: "plugin-status", description: "Open the dashboard" }, [],
      "Show me @[[03.32 Plugin status]] for $ARGUMENTS"),
  ], OPTS);
  assert.equal(errors.length, 0);
  const cmd = find(generated, "commands/plugin-status.md");
  assert.ok(cmd, "command file emitted");
  assert.equal(cmd.kind, "command");
  assert.match(cmd.content, /description: Open the dashboard/);
  assert.match(cmd.content, /Show me @\[\[03\.32 Plugin status\]\] for \$ARGUMENTS/);
  // flat: no tree frontmatter (no name/tools/skills), and the root doesn't own it
  assert.doesNotMatch(cmd.content, /^name:/m);
  assert.doesNotMatch(cmd.content, /skills:|tools:/);
  assert.doesNotMatch(find(generated, "agents/vault.md").content, /plugin-status/);
});

test("command passthrough: argument-hint / allowed-tools / model emitted; housekeeping dropped", () => {
  const { generated } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("c.md", {
      type: "command", name: "audit-plugin", description: "Audit one plugin",
      "argument-hint": "[name]", "allowed-tools": ["Bash", "Read"], model: "sonnet",
      tags: ["agent/command"], aliases: ["x"],
    }, [], "Audit $1"),
  ], OPTS);
  const cmd = find(generated, "commands/audit-plugin.md");
  assert.match(cmd.content, /argument-hint: "\[name\]"/);
  assert.match(cmd.content, /allowed-tools: \[Bash, Read\]/);
  assert.match(cmd.content, /model: sonnet/);
  assert.doesNotMatch(cmd.content, /tags:|aliases:/);
});

test("command name colliding with a skill is renamed and warned (shared /plugin:name namespace)", () => {
  const { generated, warnings } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("s.md", { type: "skill", name: "sweep" }, []),
    note("c.md", { type: "command", name: "sweep" }, [], "do the sweep"),
  ], OPTS);
  assert.ok(find(generated, "skills/sweep/SKILL.md"), "skill keeps the base name");
  assert.ok(find(generated, "commands/sweep-2.md"), "command is renamed to avoid the collision");
  assert.ok(warnings.some((w) => /command name `sweep` collides/.test(w)));
});

test("command whose name slugs to empty errors, emits no commands/.md, no empty-name warning", () => {
  const { generated, errors, warnings } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("c.md", { type: "command", name: "！！！" }, [], "body"),
  ], OPTS);
  assert.equal(generated.some((g) => g.relOut.startsWith("commands/")), false, "no broken command file");
  assert.ok(errors.some((e) => /empty name/.test(e)), "empty name is a reported error");
  assert.equal(warnings.some((w) => /command name `` collides/.test(w)), false, "no empty-backtick warning");
});
