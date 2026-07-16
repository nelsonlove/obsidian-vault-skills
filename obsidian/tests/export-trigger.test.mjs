import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { debounce, handleNoteChanged } from "../src/export-trigger.ts";

const FIELDS = () => ({ mode: "prefix", prefix: "", key: "vault-skills" });

test("debounce coalesces a rename's burst of change events into a single export after quiet", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let runs = 0;
    const requestExport = debounce(() => runs++, 750);

    // A rename fires many change events in quick succession (the file rename plus every
    // cascaded [[wikilink]] rewrite in child notes).
    requestExport();
    requestExport();
    requestExport();
    mock.timers.tick(700);
    assert.equal(runs, 0, "must not export mid-burst, when the tree is half-rewritten");

    // A late straggler event keeps pushing the settle point back.
    requestExport();
    mock.timers.tick(749);
    assert.equal(runs, 0, "still waiting for the cache to settle");

    mock.timers.tick(1);
    assert.equal(runs, 1, "exports exactly once, after the burst settles");
  } finally {
    mock.timers.reset();
  }
});

test("cancel() drops a pending export (e.g. on plugin unload)", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let runs = 0;
    const requestExport = debounce(() => runs++, 750);
    requestExport();
    mock.timers.tick(500);
    requestExport.cancel();
    mock.timers.tick(1000);
    assert.equal(runs, 0, "a cancelled debounce must never fire");
  } finally {
    mock.timers.reset();
  }
});

test("a callback may re-arm the debounce from within itself (in-flight retry, bounded)", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let busy = true; // stand-in for an export still in flight
    let runs = 0;
    const trigger = debounce(() => {
      if (busy) { trigger(); return; } // retry after another wait rather than dropping the event
      runs++;
    }, 750);

    trigger();
    mock.timers.tick(750);
    assert.equal(runs, 0, "retried while busy, did not run");
    mock.timers.tick(750);
    assert.equal(runs, 0, "still busy, retried again — no runaway loop");

    busy = false;
    mock.timers.tick(750);
    assert.equal(runs, 1, "runs exactly once when the in-flight condition clears");
    mock.timers.tick(3000);
    assert.equal(runs, 1, "no further runs after it settles");
  } finally {
    mock.timers.reset();
  }
});

test("only skill/agent/policy changes request an export", () => {
  const requested = [];
  const deps = (fm) => ({
    isEnabled: () => true,
    fields: FIELDS,
    getFrontmatter: () => fm,
    requestExport: () => requested.push(fm?.type),
  });

  handleNoteChanged("agent.md", deps({ type: "agent" }));
  handleNoteChanged("skill.md", deps({ type: "skill" }));
  handleNoteChanged("policy.md", deps({ type: "policy" }));
  handleNoteChanged("reference.md", deps({ type: "reference" })); // unrelated type
  handleNoteChanged("plain.md", deps(undefined)); // no frontmatter

  assert.deepEqual(requested, ["agent", "skill", "policy"]);
});

test("disabled export-on-save requests nothing", () => {
  let requested = 0;
  handleNoteChanged("agent.md", {
    isEnabled: () => false,
    fields: FIELDS,
    getFrontmatter: () => ({ type: "agent" }),
    requestExport: () => requested++,
  });
  assert.equal(requested, 0);
});
