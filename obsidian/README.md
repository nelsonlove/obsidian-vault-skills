# Vault Skills (Obsidian plugin)

Author skills and agents as ordinary notes in your Obsidian (Johnny Decimal) vault,
and publish them as a native **Claude Code** plugin — from inside Obsidian, one click.

This is the authoring-side companion to the `vault-skills` Claude Code plugin. It
reimplements the vault → plugin exporter natively in TypeScript over Obsidian's
metadata cache (no file walk, no YAML parsing), and manages the one symlink that lets
Claude Code load the result in place.

## What it does

1. **Discover** — every note whose frontmatter has `type: skill` or `type: agent`
   (found instantly via `app.metadataCache`).
2. **Transform** — derive Johnny Decimal area/category from the note's folder path;
   flatten into a Claude Code plugin's flat namespace, encoding origin as a name prefix
   (`56-grant-deadline-sweep`) and a description breadcrumb (`[Education & research › Grants & funding] …`).
3. **Write** — emit `skills/<name>/SKILL.md` and `agents/<name>.md` into the output
   plugin directory, overwriting idempotently via a manifest.
4. **Link** — ensure `~/.claude/skills/<plugin-name>` → the output directory, so Claude
   Code loads it in place. Then you run `/reload-plugins` (the one step the plugin can't
   do for you — there's no channel into a running Claude Code session).

## Scope = agent + owned skills

A scope isn't a bag of skills — it's an **agent that owns a skill set**. The exporter
compiles the vault into a wired cascade:

```
00 general vault agent  →  area agents  →  category agents
```

- **Auto-wired delegation** — the root vault agent delegates to every area agent, each
  area agent to its category agents (derived from the JD structure; `Agent` tool added
  automatically; nested subagents work up to 5 levels deep). Manual `delegates-to`
  wikilinks are still honored and merged in.
- **Skill ownership via preload** — each agent gets a `skills:` frontmatter list of the
  skills in its scope, so their full content is preloaded into that agent at spawn.
  Universal (00) skills belong to the root; area skills to area agents; category skills
  to category agents.
- **Synthesized root** — if the vault has no universal agent, a `00-vault` router is
  generated so the cascade always has an entry point.

> Note: the `skills:` reference format for plugin skills (`vault-skills:56-x` vs bare
> `56-x`) isn't pinned down in the docs — this exporter emits the namespaced form; if a
> live test shows preload doesn't fire, switch to bare names (one line in `transform.ts`).

## Note convention

```yaml
---
type: skill        # or: agent  (required; other notes are ignored)
description: ...    # trigger text Claude uses
# optional: name, scope, id, version, tools: [Read, Grep], model, delegates-to: ["[[other-note]]"]
---
Body = the SKILL.md body / agent system prompt.
```

Scope is derived from the JD path: notes under `00-09 …` → universal; a note in an area's
`X0` management folder → area scope; a note in a real category folder → category scope.

## Build & install

```bash
npm install
npm run build          # bundles src/ -> main.js
npm test               # tsc --noEmit + unit tests

# install into your vault
mkdir -p "<vault>/.obsidian/plugins/vault-skills"
cp manifest.json main.js "<vault>/.obsidian/plugins/vault-skills/"
# (or symlink this repo there for live dev)
```

Enable **Vault Skills** in Obsidian → Community plugins, then use the ribbon icon or the
command **"Export skills & agents to Claude Code"**.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Output plugin directory | `~/repos/vault-skills` | Where the generated Claude Code plugin is written. |
| Plugin name | `vault-skills` | CC plugin name / command namespace / symlink name. |
| Manage `~/.claude` symlink | on | Ensure `~/.claude/skills/<name>` → output dir. |
| Export on save | off | Re-export when a skill/agent note changes. |

## Relationship to the `vault-skills` Claude Code plugin

Both produce the **same artifact format**. The Claude Code plugin ships a Node CLI
exporter (`bin/export-from-vault.mjs`) for headless/marketplace use; this Obsidian plugin
is the interactive authoring path. Point both at the same output directory.

Desktop only (uses Node `fs` to write outside the vault).
