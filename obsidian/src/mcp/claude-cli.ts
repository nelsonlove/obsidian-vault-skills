import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);
const SERVER_NAME = "vault-skills";

// Obsidian's GUI PATH is minimal; the `claude` shim runs `#!/usr/bin/env node`.
const EXTRA_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
export function spawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const parts = [base.PATH, ...EXTRA_BIN_DIRS].filter(Boolean) as string[];
  return { ...base, PATH: parts.join(":") };
}

export function findClaudeBinary(opts?: { candidates?: string[]; fileExists?: (p: string) => boolean }): string | null {
  const home = os.homedir();
  const candidates = opts?.candidates ?? [
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  const exists = opts?.fileExists ?? ((p: string) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

export async function claudeIsRegistered(bin: string): Promise<boolean> {
  try { await pexecFile(bin, ["mcp", "get", SERVER_NAME], { env: spawnEnv() }); return true; }
  catch { return false; }
}

export async function claudeRegister(bin: string, bridgePath: string): Promise<void> {
  await pexecFile(bin, ["mcp", "add", "--scope", "user", SERVER_NAME, "--", "node", bridgePath], { env: spawnEnv() });
}

export async function claudeRemove(bin: string): Promise<void> {
  await pexecFile(bin, ["mcp", "remove", SERVER_NAME], { env: spawnEnv() }).catch(() => { /* ignore if absent */ });
}
