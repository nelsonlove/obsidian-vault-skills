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

Agents with `delegates-to` get the `Agent` tool added automatically and their wikilinks
resolved to the generated agent names, so area routers can spawn their category agents
(nested subagents work up to 5 levels deep).

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
