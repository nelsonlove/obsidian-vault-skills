# Vault note convention for `vault-skills`

A note becomes a native Claude Code skill or agent when its frontmatter has a `type:`
of `skill` or `agent`. Almost everything else is **derived from where the note lives**
in your Johnny Decimal tree — drop a note in the right category folder and it inherits
its scope, its owning agent, and its place in the delegation cascade.

## The model: a scope is an agent that owns skills

The exporter compiles the vault into a wired cascade:

```
00 general vault agent  →  area agents  →  category agents
```

- **Skill ownership.** Every skill is owned by the agent of its scope, and preloaded into
  that agent via the `skills:` frontmatter field (the full skill body is injected into
  the agent's context at spawn). Universal (`00`) skills → the root vault agent; area
  skills → the area agent; category skills → the category agent.
- **Auto-wired delegation.** The root delegates to every area agent; each area agent
  delegates to its category agents. This is derived from the JD structure — you don't
  wire it by hand. Agents get the `Agent` tool so the delegation is live (nested
  subagents work up to 5 levels deep; a `00 → area → category` cascade is only 3).
- **Synthesized root.** If the vault has no universal agent, a `00-vault` router is
  generated so the cascade always has an entry point. Author your own universal-scope
  agent to control the routing prompt.

You author the *notes*; the exporter derives ownership, `skills:`, and delegation.

## Frontmatter fields

| Field | Required | Applies to | Meaning |
|---|---|---|---|
| `type` | **yes** | both | `skill` or `agent`. Notes without this are ignored. |
| `description` | recommended | both | Trigger text Claude uses to decide when to load/delegate. Without it, triggering is weak. |
| `name` | no | both | Base name override. Defaults to the note's filename (slugified). |
| `scope` | no | both | `universal` \| `area` \| `category`. Overrides path derivation. |
| `id` | no | both | Numeric JD prefix override (e.g. `56`). Defaults to the derived JD code. |
| `version` | no | skill | Skill version string. |
| `tools` | no | agent | Allowlist, e.g. `[Read, Grep]`. Omit to inherit all tools. `Agent` is appended automatically when the agent delegates. |
| `model` | no | agent | `sonnet` \| `opus` \| `haiku` \| full id \| `inherit`. |
| `delegates-to` | no | agent | *Additional* explicit delegation links (wikilinks to agent notes), **merged with** the auto-wired cascade. Each resolves to the target's generated agent name. |

> You do **not** author the `skills:` field or the primary delegation wiring — the
> exporter computes them from scope and structure.

## What's derived from the path

Given `50-59 Education & research/56 Grants & funding/grant-deadline-sweep.md`:

- **area** = `50-59 Education & research` → code `50`, name `Education & research`
- **category** = `56 Grants & funding` → code `56`, name `Grants & funding`
- **scope** = `category` (a real category, not the `X0` management folder)
- **id** = `56`, **breadcrumb** = `Education & research › Grants & funding`

Special cases:
- Notes anywhere under `00-09 …` → **universal** (id `00`), cross-cutting / root-owned.
- Notes in the area's **`X0` management** category (e.g. `50 Management of…`) → **area**
  scope (id = area code, e.g. `50`), representing the area as a whole. An agent here is
  the area router.

## What the exporter produces

- **Generated name** = `<id>-<base>` → `56-grant-deadline-sweep` (deduped if needed).
- **Generated description** = `[<breadcrumb>] <your description>`.
- **Skills** → `skills/<name>/SKILL.md`, invoked as `/vault-skills:<name>`. Loaded
  globally (a plugin's skills are a flat namespace) but *owned* by their agent via preload.
- **Agents** → `agents/<name>.md`, available as the subagent `vault-skills:<name>`, with:
  - a `skills:` list of the scope's skills (namespaced, e.g. `vault-skills:56-…`);
  - `tools` including `Agent` when it delegates;
  - a routing section in the body — **Vault routing** for the root (its area agents),
    **Delegates to** for area/category agents (their sub-scope agents);
  - a short **Skills** note listing what's preloaded.

> The exact `skills:` reference format for plugin skills (namespaced `vault-skills:56-x`
> vs bare `56-x`) is not pinned down in the Claude Code docs. The exporter emits the
> namespaced form; if a live test shows preload doesn't fire, switch to bare names
> (one line in `obsidian/src/transform.ts`).

## Delegation is real, and depth-limited

Claude Code subagents can spawn nested subagents when they hold the `Agent` tool, up to
a fixed depth of **5 levels** below the main conversation. So `00 → area → category` is
a real, live cascade. The exporter grants `Agent`, auto-wires the tree from structure,
and merges in any manual `delegates-to`. Model area agents as routers that spawn their
category agents for focused work.

## Authoring vs. runtime

These notes are the **source of truth**. The `claude-plugin/skills/` and
`claude-plugin/agents/` directories are **generated artifacts** — never hand-edit them.
Edit the note, re-export from the **Vault Skills** Obsidian plugin (ribbon icon or the
*Export skills & agents to Claude Code* command), then run `/reload-plugins` in Claude
Code.
