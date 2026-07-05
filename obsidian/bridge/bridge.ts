import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface Discovery {
  vault_name: string;
  socket_path: string;
  [k: string]: unknown;
}

const ENABLE_HINT = "open Obsidian and enable the 'Vault Skills' plugin (Settings → Community plugins)";

export function filterLive(discoveries: Discovery[], exists: (p: string) => boolean = fs.existsSync): Discovery[] {
  return discoveries.filter((d) => { try { return exists(d.socket_path); } catch { return false; } });
}

export type Target =
  | { kind: "ok"; chosen: Discovery }
  | { kind: "wait" }
  | { kind: "fatal"; message: string };

export function resolveTarget(live: Discovery[], pick: string | undefined): Target {
  if (pick) {
    const hit = live.find((d) => d.vault_name === pick);
    return hit ? { kind: "ok", chosen: hit } : { kind: "wait" };
  }
  if (live.length === 1) return { kind: "ok", chosen: live[0] };
  if (live.length === 0) return { kind: "wait" };
  return { kind: "fatal", message: `vault-skills: multiple vaults open; specify --vault <name>: ${live.map((d) => d.vault_name).join(", ")}` };
}

export function deadlineMessage(all: Discovery[], pick: string | undefined): string {
  if (pick) {
    return all.some((d) => d.vault_name === pick)
      ? `vault-skills: vault '${pick}' has a discovery but no live socket — ${ENABLE_HINT}.`
      : `vault-skills: no vault named "${pick}"; available: ${all.map((d) => d.vault_name).join(", ") || "(none)"}`;
  }
  return all.length > 0
    ? `vault-skills: found discovery but no live socket — the 'Vault Skills' plugin is disabled or Obsidian is closed. Fix: ${ENABLE_HINT}.`
    : `vault-skills: no vault is currently serving MCP — ${ENABLE_HINT}.`;
}

function loadDiscoveries(): Discovery[] {
  const dir = path.join(os.homedir(), ".claude", "vault-skills-mcp");
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out: Discovery[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch { /* skip */ }
  }
  return out;
}

function parseFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function fail(msg: string): never {
  try { fs.writeSync(2, `${msg}\n`); } catch { /* ignore */ }
  process.exit(1);
}

const WAIT_MS = Number(process.env.VAULT_SKILLS_WAIT_MS ?? 30000);
const POLL_MS = Number(process.env.VAULT_SKILLS_POLL_MS ?? 500);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function tryConnect(chosen: Discovery): Promise<net.Socket | null> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(chosen.socket_path);
    sock.once("connect", () => resolve(sock));
    sock.once("error", (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      sock.destroy();
      if (code === "ENOENT" || code === "ECONNREFUSED") resolve(null); else reject(e);
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith("bridge.mjs")) {
  const pick = parseFlag(process.argv, "vault") ?? process.env.VAULT_SKILLS_VAULT;
  const deadline = Date.now() + WAIT_MS;
  (async () => {
    for (;;) {
      const all = loadDiscoveries();
      const target = resolveTarget(filterLive(all), pick);
      if (target.kind === "fatal") fail(target.message);
      if (target.kind === "ok") {
        const sock = await tryConnect(target.chosen);
        if (sock) {
          process.stdin.pipe(sock);
          sock.pipe(process.stdout);
          sock.on("close", () => process.exit(0));
          return;
        }
      }
      if (Date.now() >= deadline) fail(deadlineMessage(all, pick));
      await sleep(POLL_MS);
    }
  })().catch((e) => fail(`vault-skills bridge: ${(e as Error).message}`));
}
