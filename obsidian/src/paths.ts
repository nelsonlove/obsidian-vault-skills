import * as os from "node:os";
import * as path from "node:path";

export function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Default Claude Code plugin dir this exporter writes into (the monorepo's claude-code/). */
export function defaultOutputDir(): string {
  return path.join(os.homedir(), "repos", "vault-skills", "claude-code");
}
