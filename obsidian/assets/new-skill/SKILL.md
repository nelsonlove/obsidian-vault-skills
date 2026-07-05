---
name: new-skill
description: Scaffold a new vault skill or agent note in the Vault Skills convention. Use when the user wants to create or add a new skill or agent to their Obsidian vault (which the vault-skills exporter turns into a Claude Code skill/agent).
---

# Author a new vault skill or agent

This skill writes a new note into the **source Obsidian vault** in the Vault Skills
frontmatter convention. It's the authoring counterpart to the exporter: you create the
note here, then re-export and reload to make it a live Claude Code skill/agent.

## 1. Locate the vault

Read `${CLAUDE_PLUGIN_ROOT}/.vault-skills-manifest.json` and use its `vault` field — that
is the absolute path of the source vault this plugin was generated from. If the field is
missing or `null`, ask the user for the vault path.

## 2. Gather the inputs

Ask for whatever isn't already clear:

- **kind** — `skill` or `agent`?
- **name** — short, kebab-case (becomes the invocation name).
- **description** — the trigger text Claude uses to load/delegate to it.
- **parent** — the note's single parent **agent**:
  - a **skill's** parent is the agent that will *own* it (preload it);
  - an **agent's** parent is the agent that will *delegate to* it;
  - **omit the parent** to attach directly to the root (for a skill, that means it's
    shared/global at level 0 — the only way to share a skill across agents);
  - to create the *root* agent itself, set `root: true` and no parent (only one root).
- **body** — the SKILL.md body (for a skill) or the agent's system prompt.

To help pick a parent, list the existing agents — read the note frontmatter under the
vault (`type: agent`), or the generated `${CLAUDE_PLUGIN_ROOT}/agents/`.

Constraints to respect (the exporter validates these): `parent` must be a **single**
wikilink to an **agent**; the tree must be acyclic and reach the root; agents deeper than
5 levels won't be reachable by live delegation. Full rules: the vault's
`docs/spec-frontmatter-tree.md`.

## 3. Write the note

Choose a location in the vault (folders don't affect structure — pick the parent note's
folder, or ask). Write `<vault>/<folder>/<name>.md`:

```md
---
type: <skill|agent>
parent: "[[<parent-note-name>]]"   # omit if it should attach to the root
description: <description>
# optional: name, id, label, tools: [Read, Grep], model, version
---

<body>
```

Use `Write` to create the file (or `obsidian://new` via the shell if you want Obsidian's
create pipeline / templates to run). Do **not** write into `${CLAUDE_PLUGIN_ROOT}` — that
is generated output; the source of truth is the vault.

## 4. Tell the user to publish it

The note won't be a live skill/agent until it's exported:

1. In Obsidian, run the **Vault Skills** export (ribbon icon or *Export skills & agents to
   Claude Code*).
2. In Claude Code, run `/reload-plugins`.

Then confirm what was created and how it will be invoked (`/vault-skills:<name>` for a
skill; `vault-skills:<name>` as a subagent for an agent).
