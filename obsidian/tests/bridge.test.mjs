import { test } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { filterLive, filterConnectable, probeSocket, resolveTarget } from "../bridge/bridge.ts";

const disc = (name, sock) => ({ vault_name: name, socket_path: sock });

// --- Deterministic unit tests (injected probe, no real sockets) ---

test("filterConnectable keeps only sockets with a live listener", async () => {
  const live = disc("obsidian", "/tmp/live.sock");
  const stale = disc("obsidian-testbed", "/tmp/stale.sock");
  const probe = async (d) => d.vault_name === "obsidian"; // only the real vault answers
  assert.deepEqual(await filterConnectable([live, stale], probe), [live]);
});

test("regression: a stale second vault no longer forces a fatal 'multiple vaults'", async () => {
  // Both discovery FILES exist (filterLive passes both), but the testbed socket is dead.
  const all = [disc("obsidian", "/a.sock"), disc("obsidian-testbed", "/b.sock")];
  const exists = () => true; // pretend both socket files are present on disk
  const probe = async (d) => d.vault_name === "obsidian"; // only one actually listens

  // Old behavior: resolveTarget(filterLive(all)) => fatal, because file-existence
  // counted both as live. New behavior: probe prunes the dead one first.
  assert.equal(resolveTarget(filterLive(all, exists), undefined).kind, "fatal");
  const connectable = await filterConnectable(filterLive(all, exists), probe);
  const target = resolveTarget(connectable, undefined);
  assert.equal(target.kind, "ok");
  assert.equal(target.chosen.vault_name, "obsidian");
});

test("filterConnectable treats a throwing probe as dead", async () => {
  const d = disc("boom", "/x.sock");
  const probe = async () => { throw new Error("connect blew up"); };
  assert.deepEqual(await filterConnectable([d], probe), []);
});

// --- Integration test against real unix sockets ---

test("probeSocket: live listener true; missing and non-socket paths false", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-bridge-"));
  const liveSock = path.join(dir, "live.sock");
  const missing = path.join(dir, "missing.sock");
  const nonSocket = path.join(dir, "plain.file");
  fs.writeFileSync(nonSocket, "not a socket"); // present-but-dead, like a leftover file

  const server = net.createServer();
  await new Promise((res) => server.listen(liveSock, res));
  try {
    assert.equal(await probeSocket(disc("live", liveSock)), true);
    assert.equal(await probeSocket(disc("missing", missing)), false);
    assert.equal(await probeSocket(disc("dead", nonSocket)), false);

    // End to end: only the live vault survives, and resolution is unambiguous.
    const all = [disc("live", liveSock), disc("dead", nonSocket), disc("missing", missing)];
    const target = resolveTarget(await filterConnectable(all), undefined);
    assert.equal(target.kind, "ok");
    assert.equal(target.chosen.vault_name, "live");
  } finally {
    await new Promise((res) => server.close(res));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
