# Vault Skills (Obsidian plugin)

Author skills and agents as ordinary notes in your Obsidian vault, and publish them as a
native **Claude Code** plugin — from inside Obsidian, one click.

This is the **producer** half of the [monorepo](../README.md); it writes into the
[`../claude-code`](../claude-code) landing plugin. It runs the exporter natively in
TypeScript over Obsidian's metadata cache (no file walk, no YAML parsing). It writes only
inside its configured output dir (the plugin's own dir) — it never creates symlinks or
files *elsewhere* in `~/.claude`. Getting that dir loaded by Claude Code is a one-time
user setup (below).

## What it does

1. **Discover** — every note whose frontmatter has `type: skill` or `type: agent` (via
   `app.metadataCache`). Folders don't matter — structure comes from frontmatter.
2. **Build the tree** — resolve each note's single `parent` wikilink into a strict tree,
   and **validate** its edges (see below).
3. **Compile** — emit `skills/<name>/SKILL.md` and `agents/<name>.md`, wiring each agent's
   owned skills (`skills:` preload) and its child agents (delegation), overwriting
   idempotently via a manifest.
4. **Stop there** — the plugin does *not* load anything or reach outside its output dir.
   Loading is a one-time user setup: either point the output dir directly at a
   `~/.claude/skills/<name>` location, or symlink the output dir into `~/.claude/skills`
   yourself. After that, each export updates it in place and you just run `/reload-plugins`
   (which the plugin can't do — no channel into a running Claude Code session).

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

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Output plugin directory | `~/repos/vault-skills/claude-code` | Where the generated Claude Code plugin is written (the monorepo's landing plugin). |
| Plugin name | `vault-skills` | CC plugin name / command & subagent namespace. |
| Export on save | off | Re-export when a skill/agent note changes. |

Desktop only (uses Node `fs` to write outside the vault).
