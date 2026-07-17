import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { transformAll } from "../src/transform.ts";
import { buildGuardManifest, buildHooksJson, GUARD_PY, GUARD_SCRIPT } from "../src/guard.ts";

const OPTS = { pluginName: "vault-skills", synthesizeRoot: true };
const note = (path, fm, parentPaths = [], body = "body") => ({ path, frontmatter: fm, body, parentPaths });

test("guards: territory + hard policy (own or ancestor) → guard; soft-only or no territory → none", () => {
  const { guards } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true }),
    note("area.md", { type: "agent", name: "area", label: "Area" }, ["root.md"]),
    note("legal.md", { type: "agent", name: "legal", label: "Legal", territory: ["80-89 Divorce/**"] }, ["area.md"]),
    note("soft.md", { type: "agent", name: "soft", territory: ["30-39 Household/**"] }, ["root.md"]),
    note("bare.md", { type: "agent", name: "bare" }, ["root.md"]),
    note("hp.md", { type: "policy", severity: "hard" }, ["area.md"], "AREA-HARD"),
    note("sp.md", { type: "policy" }, ["soft.md"], "SOFT-ONLY"),
  ], OPTS);
  assert.equal(guards.length, 1, "only the hard-policy territory guards");
  assert.equal(guards[0].agent, "legal");
  assert.equal(guards[0].scope, "Area › Legal");
  assert.deepEqual(guards[0].globs, ["80-89 Divorce/**"]);
  assert.deepEqual(guards[0].hardPolicies, [{ title: "hp", path: "hp.md" }], "ancestor hard policy included");
});

test("territory on a root or crosscutting agent warns and produces no guard", () => {
  const { guards, warnings } = transformAll([
    note("root.md", { type: "agent", name: "vault", root: true, territory: ["**"] }),
    note("cc.md", { type: "agent", name: "cc", crosscutting: true, territory: ["x/**"] }, ["root.md"]),
    note("hp.md", { type: "policy", severity: "hard" }, [], "H"),
  ], OPTS);
  assert.equal(guards.length, 0);
  assert.equal(warnings.filter((w) => /territory on a (root|crosscutting) agent is ignored/.test(w)).length, 2);
});

test("buildHooksJson: base skill-runs hook always present; PreToolUse doorman only with guards", () => {
  const plain = JSON.parse(buildHooksJson(false));
  assert.ok(plain.hooks.PostToolUse, "base hook kept");
  assert.equal(plain.hooks.PreToolUse, undefined);
  const guarded = JSON.parse(buildHooksJson(true));
  assert.ok(guarded.hooks.PostToolUse, "base hook kept alongside guard");
  assert.equal(guarded.hooks.PreToolUse.length, 2);
  assert.match(guarded.hooks.PreToolUse[0].hooks[0].command, /scope-guard\.sh/);
});

// End-to-end doorman behavior: run the real script with a fixture manifest.
function runGuard(dir, input, env = {}) {
  return spawnSync("bash", [path.join(dir, "scope-guard.sh")], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, TMPDIR: path.join(dir, "tmp"), ...env },
  });
}

test("scope-guard.sh: doorman blocks first guarded write with policy pointer, passes retry and unguarded paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-guard-"));
  fs.mkdirSync(path.join(dir, "tmp"));
  const vault = path.join(dir, "vault");
  fs.mkdirSync(path.join(vault, "80-89 Divorce"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scope-guard.sh"), GUARD_SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "scope-guard.py"), GUARD_PY);
  fs.writeFileSync(path.join(dir, "guard-manifest.json"), buildGuardManifest(vault, [
    { scope: "Divorce", agent: "divorce-agent", globs: ["80-89 Divorce/**"],
      hardPolicies: [{ title: "Evidence integrity", path: "80-89 Divorce/pol.md" }] },
  ]));

  const write = (file, session) => runGuard(dir, {
    tool_name: "Write", session_id: session,
    tool_input: { file_path: path.join(vault, file) },
  });

  const first = write("80-89 Divorce/x.md", "s1");
  assert.equal(first.status, 2, "first guarded write is blocked");
  assert.match(first.stderr, /guarded territory of scope "Divorce"/);
  assert.match(first.stderr, /Evidence integrity \(80-89 Divorce\/pol\.md\)/);
  assert.match(first.stderr, /fires once per session per scope/);

  const retry = write("80-89 Divorce/x.md", "s1");
  assert.equal(retry.status, 0, "retry in the same session passes (doorman)");

  const other = write("80-89 Divorce/y.md", "s2");
  assert.equal(other.status, 2, "a new session gets its own doorman");

  const outside = write("10-19 Personal/z.md", "s3");
  assert.equal(outside.status, 0, "unguarded vault path passes");

  const bash = runGuard(dir, {
    tool_name: "Bash", session_id: "s4",
    tool_input: { command: `mv '${path.join(vault, "80-89 Divorce/a.md")}' /tmp/` },
  });
  assert.equal(bash.status, 2, "write-shaped bash command touching territory is doored");

  const bashRead = runGuard(dir, {
    tool_name: "Bash", session_id: "s5",
    tool_input: { command: `grep -r foo '${path.join(vault, "80-89 Divorce")}'` },
  });
  assert.equal(bashRead.status, 0, "read-shaped bash command passes");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("scope-guard.sh: missing manifest or malformed stdin degrade to allow", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-guard-deg-"));
  fs.mkdirSync(path.join(dir, "tmp"));
  fs.writeFileSync(path.join(dir, "scope-guard.sh"), GUARD_SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "scope-guard.py"), GUARD_PY);
  const noManifest = runGuard(dir, { tool_name: "Write", tool_input: { file_path: "/x" } });
  assert.equal(noManifest.status, 0);
  fs.writeFileSync(path.join(dir, "scope-guard.py"), GUARD_PY);
  fs.writeFileSync(path.join(dir, "guard-manifest.json"), buildGuardManifest("/v", [
    { scope: "S", agent: "s", globs: ["**"], hardPolicies: [] },
  ]));
  const badStdin = spawnSync("bash", [path.join(dir, "scope-guard.sh")], {
    input: "not json", encoding: "utf8",
    env: { ...process.env, TMPDIR: path.join(dir, "tmp") },
  });
  assert.equal(badStdin.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
