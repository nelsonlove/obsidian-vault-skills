# Vault Skills (Obsidian plugin)

Author skills and agents as ordinary notes in your Obsidian vault, and publish them as a
native **Claude Code** plugin — from inside Obsidian, one click.

This is the **producer** half of the [monorepo](../README.md): it runs the exporter
natively in TypeScript over Obsidian's metadata cache (no file walk, no YAML parsing) and
writes the Claude Code plugin — by default straight into `~/.claude/skills/vault-skills`,
Claude Code's load location. It writes only inside its configured output dir (the plugin's
own dir); it never creates symlinks or files *elsewhere* in `~/.claude`.

## What it does

1. **Discover** — every note whose frontmatter has `type: skill` or `type: agent` (via
   `app.metadataCache`). Folders don't matter — structure comes from frontmatter.
2. **Build the tree** — resolve each note's single `parent` wikilink into a strict tree,
   and **validate** its edges (see below).
3. **Compile** — emit `skills/<name>/SKILL.md` and `agents/<name>.md`, wiring each agent's
   owned skills (`skills:` preload) and its child agents (delegation), overwriting
   idempotently via a manifest.
4. **Load it** — the default output **is** `~/.claude/skills/vault-skills`, so the export
   lands right where Claude Code loads from — **no symlink needed**. Just run
   `/reload-plugins` (the one step the plugin can't do — no channel into a running Claude
   Code session). The plugin only ever writes its own output dir; if you point it
   elsewhere, link/install that dir into `~/.claude/skills` yourself.

## The model: a scope is an agent that owns skills

A note declares its `type` and a single `parent` (a `[[wikilink]]`). From those edges the
exporter builds the tree and compiles a cascade:

```
root vault agent  →  child agents  →  grandchild agents   (delegation, up to 5 levels)
```

- **Ownership** — a skill's `parent` is the agent that **owns** it; that agent preloads it
  via the `skills:` frontmatter field (full body injected at spawn).
- **Delegation** — an agent's `parent` is the agent that **delegates to** it; the parent
  gets the `Agent` tool and a routing section listing its children.
- **Sharing = level 0** — strictly one parent. To share a skill across agents, give it **no
  `parent`** — it lands at level 0, owned by the root and globally invokable. That's the
  only sharing mechanism.
- **Synthesized root** — if no note has `root: true`, a `vault` root is generated so the
  cascade always has an entry point.
- **Policy notes** — a `type: policy` note injects its body as shared context into every
  agent in its `parent`'s subtree (no parent ⇒ global).
- **Validation** — unresolved / wrong-type / multiple parents, cycles, unreachable nodes,
  and depth past the 5-level nesting cap are reported (errors skip the node; warnings
  advise) in the export notice.

Full rules and field reference: [`../docs/spec-frontmatter-tree.md`](../docs/spec-frontmatter-tree.md)
and [`../docs/frontmatter-convention.md`](../docs/frontmatter-convention.md).

> Preload uses the **namespaced** `skills:` ref (`vault-skills:<name>`) — verified firing
> in a live Claude Code session (a preloaded skill's content reached a subagent that had no
> Skill tool), so no change is needed.

## Note convention (short)

```yaml
---
type: agent          # or: skill  (required; other notes are ignored)
parent: "[[research]]"   # single wikilink to the parent agent; omit ⇒ child of root
# root: true             # marks the one root agent
description: ...          # trigger text
# optional: name, id, label, version, tools: [Read, Grep], model
---
Body = the SKILL.md body / agent system prompt.
```

## Build & install

```bash
npm install
npm run build          # bundles src/ -> main.js
npm test               # tsc --noEmit + unit tests

# install into your vault
mkdir -p "<vault>/.obsidian/plugins/vault-skills"
cp manifest.json main.js "<vault>/.obsidian/plugins/vault-skills/"
# (or symlink this dir there for live dev)
```

Enable **Vault Skills** in Obsidian → Community plugins, then use the ribbon icon or the
command **"Export skills & agents to Claude Code"**, and `/reload-plugins` in Claude Code.

## Commands

In the command palette (in addition to the export ribbon icon):

- **Export skills & agents to Claude Code** — writes the plugin.
- **Validate tree** — check for errors/warnings without writing (unresolved parent, cycle, depth>5, …).
- **Show tree** — the current agent/skill hierarchy.
- **Mark note as skill / agent / policy** — set the vault-skills fields on the active note (pick type + parent), honoring your field mode. You create the note however you like; this just marks it.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Output plugin directory | `~/.claude/skills/vault-skills` | Where the plugin is written — defaults to Claude Code's load location (no symlink needed). |
| Plugin name | `vault-skills` | CC plugin name / command & subagent namespace. |
| Export on save | off | Re-export when a skill/agent note changes. |

Desktop only (uses Node `fs` to write outside the vault).
