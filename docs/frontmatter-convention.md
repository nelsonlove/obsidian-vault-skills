# Vault note convention (authoring guide)

How to author skill/agent notes for `vault-skills`. This is the friendly guide; the exact
rules and validation live in [`spec-frontmatter-tree.md`](spec-frontmatter-tree.md).

A note becomes a skill or agent when its frontmatter has `type: skill | agent`. Its place
in the hierarchy comes from a single **`parent`** wikilink — **not** from which folder it
sits in. Put notes wherever you like; the tree lives in frontmatter.

## Fields

| Field | Req | Applies | Meaning |
|---|---|---|---|
| `type` | **yes** | both | `skill` or `agent`. Notes without it are ignored. |
| `parent` | no | both | A **single** `[[wikilink]]` to the parent **agent**. Omit ⇒ child of the root. A list is an error. |
| `root` | no | agent | `true` marks the one root agent. |
| `description` | rec | both | Trigger text Claude uses to load/delegate. |
| `name` | no | both | Base name (default: filename slug). |
| `id` | no | both | Optional name prefix, e.g. `56` → `56-<slug>`. |
| `label` | no | both | Display label used in breadcrumbs (default: name). |
| `tools` | no | agent | Allowlist, e.g. `[Read, Grep]`. `Agent` is appended automatically when the agent has children. |
| `model` | no | agent | `sonnet` \| `opus` \| `haiku` \| id \| `inherit`. |
| `version` | no | skill | Skill version. |

## The three edges

Everything is one relationship — **`parent`** — read three ways:

- **Skill → owner.** A skill's `parent` is the agent that owns it. The exporter preloads
  the skill into that agent via `skills:` (its full body is injected at spawn).
- **Agent → delegator.** An agent's `parent` is the agent above it; the parent gets the
  `Agent` tool and a routing section so it can spawn this one (nested up to 5 levels).
- **No parent → level 0.** With strictly one parent, the way to **share** a skill across
  agents is to give it *no* `parent`: it lands at level 0, owned by the root and globally
  invokable. Level 0 is the only place a skill is reachable from everywhere.

## Worked example

```
vault-agent.md      →  type: agent, root: true
add-callout.md      →  type: skill                      (no parent ⇒ shared, level 0)
research.md         →  type: agent, parent: [[vault-agent]]
grants.md           →  type: agent, parent: [[research]]
deadline-sweep.md   →  type: skill, parent: [[grants]]
```

compiles to: a `vault` root that owns `add-callout` and routes to `research`; `research`
routes to `grants`; `grants` owns `deadline-sweep` (preloaded) and does the work. Skills
invoke as `/vault-skills:<name>`; agents are the subagents `vault-skills:<name>`.

If you omit the root note, a `vault` root is synthesized so the cascade has an entry point.

## Validation

The exporter reports (errors skip the node; warnings advise): unresolved `parent`, a
parent that's a skill, multiple parents, cycles, nodes that don't reach the root, and
agents past the 5-level nesting cap. Details in the spec.

## Authoring vs. runtime

These notes are the **source of truth**. The plugin's `claude-code/skills/` and
`claude-code/agents/` are **generated** — never hand-edit them. Edit the note, re-export
from the **Vault Skills** Obsidian plugin (ribbon icon or the *Export skills & agents to
Claude Code* command), then run `/reload-plugins` in Claude Code.
