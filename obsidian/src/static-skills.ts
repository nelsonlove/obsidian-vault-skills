// Static files shipped inside the plugin (the bundled new-skill skill + a plugin hooks.json). The
// exporter emits these into the output dir alongside generated content, so a single export produces
// the complete Claude Code plugin at the load location — no symlink needed.
//
// The SKILL.md source lives in ../assets and is embedded at build time by esbuild (the
// __NEW_SKILL_MD__ define). Under `tsx` (tests) the define is absent, so STATIC_FILES is
// empty — the emission path is exercised by the real build, not the unit tests.

declare const __NEW_SKILL_MD__: string | undefined;
declare const __NEW_SKILL_CONVENTIONS__: string | undefined;

export interface StaticFile {
  relOut: string;
  content: string;
}

const newSkillMd = typeof __NEW_SKILL_MD__ !== "undefined" ? __NEW_SKILL_MD__ : "";
const conventionsMd = typeof __NEW_SKILL_CONVENTIONS__ !== "undefined" ? __NEW_SKILL_CONVENTIONS__ : "";

// Plugin-provided hook: Claude Code auto-loads a plugin's hooks/hooks.json. This one stamps a
// per-skill last-run file on every Skill invocation, so agents have a cheap "when did skill X last
// run" signal via `cat ~/.claude/skill-runs/<skill>`. The command is self-contained (no
// ${CLAUDE_PLUGIN_ROOT} script) and degrades to a no-op if jq is missing. Built as an object so the
// emitted JSON is always well-formed.
export const HOOKS_JSON = JSON.stringify({
  hooks: {
    PostToolUse: [
      {
        matcher: "Skill",
        hooks: [
          {
            type: "command",
            command: "{ mkdir -p ~/.claude/skill-runs && s=$(jq -r '.tool_input.skill // empty' | tr '/' '-') && [ -n \"$s\" ] && date -Iseconds > ~/.claude/skill-runs/\"$s\"; } 2>/dev/null || true",
          },
        ],
      },
    ],
  },
}, null, 2) + "\n";

// The hooks.json is not build-dependent, but it's gated with the new-skill static files so unit
// tests (which run without the esbuild defines) still see an empty STATIC_FILES and don't have to
// account for emitted files. A real build always has newSkillMd, so the hook always ships.
export const STATIC_FILES: StaticFile[] = newSkillMd
  ? [
      { relOut: "skills/new-skill/SKILL.md", content: newSkillMd },
      ...(conventionsMd ? [{ relOut: "skills/new-skill/conventions.md", content: conventionsMd }] : []),
      { relOut: "hooks/hooks.json", content: HOOKS_JSON },
    ]
  : [];
