// Territory guard — generated PreToolUse hook files.
//
// A scope agent may declare `territory:` (vault-relative globs) in frontmatter. When such a
// scope also carries `severity: hard` policies, the export emits a doorman hook: the first
// write into that territory per session is denied with a message naming the scope and its
// hard policies; the retry passes. Delivery-at-the-moment-of-danger, not a wall — hooks
// can't tell agents apart, so a permanent block would break the scope's own residents.
//
// Geography here is *declared data* (frontmatter globs compiled into a manifest), never an
// assumed layout — see the spec's "frontmatter over geography" principle.

import { HOOKS_JSON } from "./static-skills.js";
import type { Guard } from "./transform.js";

/** hooks/hooks.json content: the static base (skill last-run stamp) plus, when guards
 *  exist, PreToolUse doorman entries pointing at the shipped guard script. */
export function buildHooksJson(withGuard: boolean): string {
  const base = JSON.parse(HOOKS_JSON) as { hooks: Record<string, unknown[]> };
  if (withGuard) {
    const cmd = { type: "command", command: '"${CLAUDE_PLUGIN_ROOT}/hooks/scope-guard.sh"' };
    base.hooks.PreToolUse = [
      { matcher: "Edit|Write|NotebookEdit", hooks: [cmd] },
      { matcher: "Bash", hooks: [cmd] },
    ];
  }
  return JSON.stringify(base, null, 2) + "\n";
}

/** guard-manifest.json content, consumed by the script at hook time. */
export function buildGuardManifest(vaultPath: string | undefined, guards: Guard[]): string {
  return JSON.stringify({ vaultPath: vaultPath ?? null, guards }, null, 2) + "\n";
}

/** The doorman shim. Locates the manifest and hands the hook's stdin (the tool-call JSON)
 *  through to the python matcher — the python source must be a sidecar file, NOT a
 *  `python3 -` heredoc, which would consume the stdin the matcher needs to read. Degrades
 *  to allow if python3 is missing: the guard is a delivery mechanism, not a security
 *  boundary. Exit 2 blocks the tool call and feeds stderr back to the model. */
export const GUARD_SCRIPT = `#!/bin/bash
# vault-skills territory guard — generated; do not edit. See docs/spec-frontmatter-tree.md.
dir="$(cd "$(dirname "$0")" && pwd)"
command -v python3 >/dev/null 2>&1 || exit 0
[ -f "$dir/guard-manifest.json" ] && [ -f "$dir/scope-guard.py" ] || exit 0
exec python3 "$dir/scope-guard.py" "$dir/guard-manifest.json"
`;

/** The matcher (JSON + fnmatch + per-session/scope marker files in $TMPDIR). */
export const GUARD_PY = `import fnmatch, hashlib, json, os, re, sys, tempfile

try:
    manifest = json.load(open(sys.argv[1]))
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

vault = manifest.get("vaultPath") or ""
guards = manifest.get("guards") or []
if not vault or not guards:
    sys.exit(0)

tool = data.get("tool_name", "")
ti = data.get("tool_input") or {}
sid = str(data.get("session_id") or os.getppid())

def vault_rel(p):
    if not p:
        return None
    p, v = os.path.abspath(p), os.path.abspath(vault)
    return os.path.relpath(p, v) if p == v or p.startswith(v + os.sep) else None

hits = []
if tool in ("Edit", "Write", "NotebookEdit"):
    r = vault_rel(ti.get("file_path") or ti.get("notebook_path"))
    if r:
        hits = [g for g in guards if any(fnmatch.fnmatch(r, pat) for pat in g.get("globs", []))]
elif tool == "Bash":
    cmd = ti.get("command", "")
    # Only write-shaped commands; prefix match on the glob's literal head. Coarse by design.
    if re.search(r"\\b(mv|rm|cp|tee|trash|rsync|ditto)\\b|>{1,2}|sed -i", cmd):
        for g in guards:
            heads = [os.path.join(vault, pat.split("*")[0].rstrip("/")) for pat in g.get("globs", [])]
            if any(h and h in cmd for h in heads):
                hits.append(g)

if not hits:
    sys.exit(0)

mark_dir = os.path.join(tempfile.gettempdir(), "vault-skills-guard")
os.makedirs(mark_dir, exist_ok=True)
blocked = []
for g in hits:
    key = hashlib.sha1((sid + "|" + g["scope"]).encode()).hexdigest()[:16]
    mark = os.path.join(mark_dir, key)
    if os.path.exists(mark):
        continue
    open(mark, "w").close()  # marker first: the retry passes (doorman, not a wall)
    blocked.append(g)
if not blocked:
    sys.exit(0)

msg = []
for g in blocked:
    pols = "\\n".join("  - %s (%s)" % (p["title"], p["path"]) for p in g.get("hardPolicies", []))
    msg.append('This write touches guarded territory of scope "%s" — its hard policies bind here:\\n%s' % (g["scope"], pols))
msg.append("Read them first (a crosscutting agent's compiled prompt already includes them in full), then retry — this gate fires once per session per scope.")
print("\\n\\n".join(msg), file=sys.stderr)
sys.exit(2)
`;
