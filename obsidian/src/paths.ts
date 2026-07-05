import * as os from "node:os";
import * as path from "node:path";

export function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Default output dir: Claude Code's skills-dir load location, so the exporter writes the
 *  plugin straight into where Claude Code loads it — no symlink needed. */
export function defaultOutputDir(): string {
  return path.join(os.homedir(), ".claude", "skills", "vault-skills");
}
