# vault-skills

Author skills and agents as notes in an Obsidian vault, and load them as a native
**Claude Code** plugin — organized as a tree where each agent owns its skills and
delegates to its child agents.

This is a **monorepo with two halves — a producer and a product:**

```
your vault ─▶ obsidian/ (producer) ─writes─▶ claude-code/ (product) ─▶ ~/.claude/skills ─▶ Claude Code
```

| Directory | What it is | Runtime |
|---|---|---|
| [`obsidian/`](obsidian) | The **Obsidian plugin** — the exporter. Discovers `type: skill\|agent` notes via the metadata cache, builds/validates the tree, and writes the Claude Code plugin. | runs inside Obsidian |
| [`claude-code/`](claude-code) | The **Claude Code plugin** — the landing zone the exporter populates and Claude Code loads. | loaded by Claude Code |
| [`docs/`](docs) | The note convention and the build spec. | — |

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
- edges are **validated** (unresolved / wrong-type / multiple parents, cycles, unreachable,
  depth past the 5-level nesting cap).

See [`docs/frontmatter-convention.md`](docs/frontmatter-convention.md) (authoring) and
[`docs/spec-frontmatter-tree.md`](docs/spec-frontmatter-tree.md) (full rules).

## Quick start

```bash
# build the Obsidian plugin
cd obsidian && npm install && npm run build && npm test

# install it into your vault
mkdir -p "<vault>/.obsidian/plugins/vault-skills"
cp obsidian/manifest.json obsidian/main.js "<vault>/.obsidian/plugins/vault-skills/"
```

Enable **Vault Skills** in Obsidian; its default output is this repo's `claude-code/`. To
load it, do a **one-time** setup — symlink that dir into Claude Code's skills dir:

```bash
ln -s ~/repos/vault-skills/claude-code ~/.claude/skills/vault-skills
```

The Obsidian plugin only writes its own output dir; it never creates this link for you.
After that, each export updates the content in place — hit export, then `/reload-plugins`.
