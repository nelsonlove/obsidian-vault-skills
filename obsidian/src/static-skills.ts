// Static skills shipped inside the plugin. The exporter emits these into the output dir
// alongside generated content, so a single export produces the complete Claude Code plugin
// at the load location — no symlink needed.
//
// The SKILL.md source lives in ../assets and is embedded at build time by esbuild (the
// __NEW_SKILL_MD__ define). Under `tsx` (tests) the define is absent, so STATIC_FILES is
// empty — the emission path is exercised by the real build, not the unit tests.

declare const __NEW_SKILL_MD__: string | undefined;

export interface StaticFile {
  relOut: string;
  content: string;
}

const newSkillMd = typeof __NEW_SKILL_MD__ !== "undefined" ? __NEW_SKILL_MD__ : "";

export const STATIC_FILES: StaticFile[] = newSkillMd
  ? [{ relOut: "skills/new-skill/SKILL.md", content: newSkillMd }]
  : [];
