import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assetDirFor, collectAssets, copyAsset } from "../src/assets.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vs-assets-"));
const write = (dir, rel, content = "x") => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

test("assetDirFor maps a note path into the parallel tree", () => {
  assert.equal(
    assetDirFor("/docs", "00-09 System/00.05 Agents/skills/sessions.md"),
    path.join("/docs", "00-09 System/00.05 Agents/skills", "sessions"),
  );
  assert.equal(assetDirFor("/docs", "top.md"), path.join("/docs", "top"));
});

test("collectAssets lists files recursively, skipping .DS_Store", async () => {
  const dir = tmp();
  write(dir, "bin/sessions.py");
  write(dir, "reference.md");
  write(dir, ".DS_Store");
  const { files, warnings } = await collectAssets(dir);
  assert.deepEqual(files.map((f) => f.rel).sort(), ["bin/sessions.py", "reference.md"]);
  assert.equal(warnings.length, 0);
});

test("collectAssets returns empty for a missing dir", async () => {
  const { files, warnings } = await collectAssets(path.join(tmp(), "nope"));
  assert.deepEqual(files, []);
  assert.equal(warnings.length, 0);
});

test("collectAssets materializes iCloud placeholders via the downloader", async () => {
  const dir = tmp();
  write(dir, "bin/.tool.py.icloud", "placeholder");
  const { files, warnings } = await collectAssets(dir, {
    download: (logical) => {
      fs.writeFileSync(logical, "real content");
      fs.rmSync(path.join(path.dirname(logical), `.${path.basename(logical)}.icloud`));
    },
    pollMs: 1,
    timeoutMs: 200,
  });
  assert.equal(warnings.length, 0);
  assert.deepEqual(files.map((f) => f.rel), ["bin/tool.py"]);
  assert.equal(fs.readFileSync(files[0].abs, "utf8"), "real content");
});

test("collectAssets warns and skips when materialization times out", async () => {
  const dir = tmp();
  write(dir, ".gone.txt.icloud", "placeholder");
  const { files, warnings } = await collectAssets(dir, {
    download: () => { /* never materializes */ },
    pollMs: 1,
    timeoutMs: 10,
  });
  assert.deepEqual(files, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not materialize/);
});

test("copyAsset preserves the executable bit", () => {
  const dir = tmp();
  const src = write(dir, "run.sh", "#!/bin/sh\n");
  fs.chmodSync(src, 0o755);
  const dest = path.join(tmp(), "out", "run.sh");
  copyAsset(src, dest);
  assert.equal(fs.statSync(dest).mode & 0o111, 0o111, "executable bits preserved");
  assert.equal(fs.readFileSync(dest, "utf8"), "#!/bin/sh\n");
});
