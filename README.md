# vault-skills

Author skills and agents as notes in an Obsidian (Johnny Decimal) vault, and load them
as a native **Claude Code** plugin — with each agent owning its scope's skills, wired
into a `00 → area → category` cascade.

This is a **monorepo with two halves — a producer and a product:**

```
your vault ─▶ obsidian/ (producer) ─writes─▶ claude-plugin/ (product) ─▶ ~/.claude/skills ─▶ Claude Code
```

| Directory | What it is | Runtime |
|---|---|---|
| [`obsidian/`](obsidian) | The **Obsidian plugin** — the exporter. Discovers `type: skill\|agent` notes via the metadata cache, transforms/wires them, and writes the Claude Code plugin. | runs inside Obsidian |
| [`claude-plugin/`](claude-plugin) | The **Claude Code plugin** — the landing zone the exporter populates and Claude Code loads. | loaded by Claude Code |
| [`docs/`](docs) | The vault note convention (`type`, scope derivation, `delegates-to`, ownership). | — |

## The model

A scope is an **agent that owns a skill set**. The exporter compiles the vault into a
cascade — a general `00` vault agent that delegates to area agents, which delegate to
category agents — and preloads each agent's scope skills via the `skills:` frontmatter
field. See [`obsidian/README.md`](obsidian/README.md) and
[`docs/frontmatter-convention.md`](docs/frontmatter-convention.md).

## Quick start

```bash
# build the Obsidian plugin
cd obsidian && npm install && npm run build && npm test

# install it into your vault
mkdir -p "<vault>/.obsidian/plugins/vault-skills"
cp obsidian/manifest.json obsidian/main.js "<vault>/.obsidian/plugins/vault-skills/"
```

Enable **Vault Skills** in Obsidian. Its default output is this repo's `claude-plugin/`,
and it manages the `~/.claude/skills/vault-skills → claude-plugin` symlink. Hit the
export command, then `/reload-plugins` in Claude Code.
