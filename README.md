# vault-skills

Author skills and agents as notes in an Obsidian vault, and load them as a native
**Claude Code** plugin — organized as a tree where each agent owns its skills and
delegates to its child agents.

This repo is the **Obsidian plugin (the producer) + docs**. The Obsidian plugin generates
the **Claude Code plugin (the product)** straight into Claude Code's load location:

```
your vault ─▶ obsidian/ (producer) ─writes─▶ ~/.claude/skills/vault-skills ─▶ Claude Code loads it
```

| Directory | What it is | Runtime |
|---|---|---|
| [`obsidian/`](obsidian) | The **Obsidian plugin** — the exporter (and an MCP server). Discovers skill/agent/policy notes (by `type:` field, or by tag — e.g. `#agent/skill` — when Type source is set to tags) via the metadata cache, builds/validates the tree, and writes the Claude Code plugin (generated content **plus** the bundled `new-skill` helper). | runs inside Obsidian |
| [`docs/`](docs) | The note convention and the build spec. | — |
| [`claude-code/`](claude-code) | Reference scaffold (manifest + README). The live plugin is generated to `~/.claude/skills/vault-skills` by default, not here. | — |

## The model

Structure lives in **frontmatter, not folders**. Each note declares its `type`
(`skill`/`agent`) and a single `parent` (a `[[wikilink]]`); the exporter builds a strict
tree and compiles it:

- a skill's `parent` is the agent that **owns** it (preloaded via `skills:`);
- an agent's `parent` is the agent that **delegates to** it (gets the `Agent` tool + a
  routing section);
- **sharing = level 0** — one parent only; a skill with no `parent` is owned by the root
  and globally invokable;
- a **root** is the agent marked `root: true`, or one is synthesized;
- a **`type: policy`** note injects shared context into every agent in its `parent`'s
  subtree (no parent ⇒ global);
- edges are **validated** (unresolved / wrong-type / multiple parents, cycles, unreachable,
  depth past the 5-level nesting cap);
- a skill's **supporting files** (scripts, references) live at the same relative path in a
  parallel filesystem tree (the *Supporting-files tree* setting; iCloud-evicted files are
  downloaded first) and are bundled into the generated `skills/<name>/` dir;
- skill notes may set the documented SKILL.md keys (`user-invocable`, `allowed-tools`,
  `context`, …) and they **pass through** to the generated skill;
- **Export release to repo** packages the identical plugin into a git checkout and stamps
  a version into `.claude-plugin/plugin.json` — commit & tag there to publish.

The plugin also serves a **`vault-skills` MCP server**, so an agent can validate, inspect,
export, release, and mark notes without the Obsidian UI
(`vault_skills_{validate,tree,export,release,mark}`).

See [`docs/frontmatter-convention.md`](docs/frontmatter-convention.md) (authoring) and
[`docs/spec-frontmatter-tree.md`](docs/spec-frontmatter-tree.md) (full rules).

## Install

**Via BRAT (recommended).** Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
from Community Plugins, then *Add beta plugin* → `nelsonlove/vault-skills`. BRAT installs the
latest release and keeps it updated. Enable **Vault Skills** in Obsidian afterward.

**From source:**

```bash
# build the Obsidian plugin
cd obsidian && npm install && npm run build && npm test

# install it into your vault
mkdir -p "<vault>/.obsidian/plugins/vault-skills"
cp obsidian/manifest.json obsidian/main.js "<vault>/.obsidian/plugins/vault-skills/"
```

Enable **Vault Skills** in Obsidian. Its default output is `~/.claude/skills/vault-skills`
— Claude Code's skills-dir load location — so the exporter writes the whole plugin
(generated skills/agents **plus** the bundled `new-skill` helper) straight into where
Claude Code loads it. **No symlink needed** — hit export, then `/reload-plugins`.

The plugin only ever writes its own output dir; point it elsewhere if you prefer and
link/install that dir into `~/.claude/skills` yourself.
