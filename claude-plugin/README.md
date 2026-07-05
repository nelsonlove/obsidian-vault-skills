# vault-skills (Claude Code plugin)

The **product** half of the monorepo: the Claude Code plugin that receives the skills
and agents exported from your Obsidian vault by the [`../obsidian`](../obsidian) plugin.

- `.claude-plugin/plugin.json` — the manifest (static; committed).
- `skills/` and `agents/` — **generated** landing dirs, populated by the exporter. Their
  contents are git-ignored (they're a projection of your vault, regenerated locally);
  only the `.gitkeep` placeholders are tracked.

## How it gets loaded

The Obsidian exporter writes here (its default output dir is this directory) and ensures
the symlink:

```
~/.claude/skills/vault-skills  →  <repo>/claude-plugin
```

so Claude Code loads it in place as `vault-skills@skills-dir`. After each export, run
`/reload-plugins` in Claude Code.

Skills invoke as `/vault-skills:<name>`; agents as `vault-skills:<name>`. The exporter
builds a tree from each note's `parent` edge — every agent owns its skills (preloaded)
and delegates to its child agents — see
[`../docs/frontmatter-convention.md`](../docs/frontmatter-convention.md).

Do not hand-edit `skills/` or `agents/` — they are generated. Edit the vault notes and
re-export.
