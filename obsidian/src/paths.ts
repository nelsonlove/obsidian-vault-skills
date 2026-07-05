import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Default Claude Code plugin dir this exporter writes into (the monorepo's claude-plugin/). */
export function defaultOutputDir(): string {
  return path.join(os.homedir(), "repos", "vault-skills", "claude-plugin");
}

/** The in-place load location: ~/.claude/skills/<pluginName>. */
export function claudeSkillsLink(pluginName: string): string {
  return path.join(os.homedir(), ".claude", "skills", pluginName);
}

export type SymlinkStatus = "created" | "already" | "exists-not-symlink" | "error";

/** Ensure `linkPath` is a symlink pointing at `target`, repointing if it drifted. */
export function ensureSymlink(target: string, linkPath: string): { status: SymlinkStatus; detail?: string } {
  try {
    const lst = fs.lstatSync(linkPath, { throwIfNoEntry: false });
    if (lst) {
      if (lst.isSymbolicLink()) {
        const cur = fs.readlinkSync(linkPath);
        const resolved = path.resolve(path.dirname(linkPath), cur);
        if (resolved === path.resolve(target)) return { status: "already" };
        fs.unlinkSync(linkPath); // drifted — repoint
      } else {
        return { status: "exists-not-symlink", detail: linkPath };
      }
    }
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(path.resolve(target), linkPath);
    return { status: "created" };
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}
