import { test } from "node:test";
import assert from "node:assert/strict";
import { HOOKS_JSON } from "../src/static-skills.ts";

test("HOOKS_JSON is a valid plugin hooks.json that stamps a per-skill last-run file", () => {
  const j = JSON.parse(HOOKS_JSON); // must be well-formed JSON
  const post = j.hooks?.PostToolUse;
  assert.ok(Array.isArray(post) && post.length === 1, "one PostToolUse entry");
  assert.equal(post[0].matcher, "Skill", "matches the Skill tool");
  const cmd = post[0].hooks[0];
  assert.equal(cmd.type, "command");
  assert.match(cmd.command, /skill-runs/, "writes into ~/.claude/skill-runs");
  assert.match(cmd.command, /tool_input\.skill/, "keys off the invoked skill name");
  assert.match(cmd.command, /\|\| true/, "degrades to a no-op on failure");
  assert.match(cmd.command, /tr '\/:' '--'/, "sanitizes both / and : for portable filenames");
  assert.doesNotMatch(cmd.command, /-Iseconds/, "avoids the non-portable date -Iseconds");
  assert.match(cmd.command, /date \+%Y-%m-%dT/, "uses a BSD/GNU-portable date format");
});
