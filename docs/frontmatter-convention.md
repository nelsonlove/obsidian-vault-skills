# Vault note convention for `vault-skills`

A note becomes a native Claude Code skill or agent when its frontmatter has a
`type:` of `skill` or `agent`. Everything else is **derived from where the note
lives** in your Johnny Decimal tree, so authoring stays lightweight — drop a note
in the right category folder and it inherits its scope.

## Frontmatter fields

| Field | Required | Applies to | Meaning |
|---|---|---|---|
| `type` | **yes** | both | `skill` or `agent`. Notes without this are ignored. |
| `description` | recommended | both | The trigger text Claude uses to decide when to load it. Without it, triggering is weak. |
| `name` | no | both | Base name override. Defaults to the note's filename (slugified). |
| `scope` | no | both | `universal` \| `area` \| `category`. Overrides path derivation. |
| `id` | no | both | Numeric JD prefix override (e.g. `56`). Defaults to the derived JD code. |
| `version` | no | skill | Skill version string. |
| `tools` | no | agent | Allowlist, e.g. `[Read, Grep, Glob]`. Omit to inherit all tools. If the note has `delegates-to`, `Agent` is added automatically so it can spawn its sub-agents. |
| `model` | no | agent | `sonnet` \| `opus` \| `haiku` \| full id \| `inherit`. |
| `delegates-to` | no | agent | Wikilinks to sub-scope agent notes, e.g. `["[[grant-deadline-sweep]]"]`. Each resolves to the target's generated agent name and is rendered as a "Delegates to" section the router spawns (see below). |

## What's derived from the path

Given `50-59 Education & research/56 Grants & funding/grant-deadline-sweep.md`:

- **area** = `50-59 Education & research` → code `50`, name `Education & research`
- **category** = `56 Grants & funding` → code `56`, name `Grants & funding`
- **scope** = `category` (a real category, not the `X0` management folder)
- **id** = `56`, **breadcrumb** = `Education & research › Grants & funding`

Special cases:
- Notes anywhere under `00-09 …` → **universal** (id `00`), always-on cross-cutting.
- Notes in the area's **`X0` management** category (e.g. `50 Management of…`) → **area** scope (id = area code, e.g. `50`), representing the area as a whole.

## What the exporter produces

Plugins are a **flat namespace with no runtime cascade**, so the JD hierarchy is
encoded into the generated artifacts rather than enforced at load time:

- **Generated name** = `<id>-<base>` → `56-grant-deadline-sweep`
- **Generated description** = `[<breadcrumb>] <your description>` →
  `[Education & research › Grants & funding] Sweep grant notes for deadlines…`
- Skills land at `skills/<name>/SKILL.md`; agents at `agents/<name>.md`.
- Invoked as `/vault-skills:56-grant-deadline-sweep`.

## `delegates-to` and nested agents

Claude Code subagents **can** spawn nested subagents — provided they hold the `Agent`
tool, up to a fixed depth of **5 levels** below the main conversation. So an "area
agent → category agent" call is a real, live delegation, not just documentation.

When a note has `delegates-to`, the exporter:
- makes the agent able to delegate — if `tools` is listed explicitly, `Agent` is added
  automatically (if `tools` is omitted, the agent inherits all tools, which already
  include `Agent`); and
- resolves each `[[wikilink]]` to the **generated name** of the target agent and renders
  a "Delegates to" section instructing the router to spawn it.

A Johnny Decimal cascade is only 2–3 levels deep (main → area → category), well within
the depth-5 budget. Model area agents as routers that spawn their category agents for
focused work.

## Authoring vs. runtime

These notes are the **source of truth**. The plugin's `skills/` and `agents/`
directories are **generated artifacts** — never hand-edit them. Edit the note and
re-run `/vault-skills:export`, then `/reload-plugins`.
