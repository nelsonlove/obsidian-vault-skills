# Vault note convention (authoring guide)

How to author skill/agent notes for `vault-skills`. This is the friendly guide; the exact
rules and validation live in [`spec-frontmatter-tree.md`](spec-frontmatter-tree.md).

A note becomes a skill or agent when its frontmatter has `type: skill | agent` — or, if you
switch the **Type source** setting to *tags*, when it carries the matching tag (see
[Declaring the kind](#declaring-the-kind-type-field-vs-tags) below). Its place in the
hierarchy comes from a single **`parent`** wikilink — **not** from which folder it sits in.
Put notes wherever you like; the tree lives in frontmatter.

## Fields

| Field | Req | Applies | Meaning |
|---|---|---|---|
| `type` | **yes** | all | `skill`, `agent`, or `policy`. Notes without it are ignored. |
| `parent` | no | both | A **single** `[[wikilink]]` to the parent **agent**. Omit ⇒ child of the root. A list is an error. |
| `root` | no | agent | `true` marks the one root agent. |
| `description` | rec | both | Trigger text Claude uses to load/delegate. |
| `name` | no | both | Base name (default: filename slug). |
| `id` | no | both | Optional name prefix, e.g. `56` → `56-<slug>`. |
| `label` | no | both | Display label used in breadcrumbs (default: name). |
| `tools` | no | agent | Allowlist, e.g. `[Read, Grep]`. `Agent` is appended when it has child agents, `Skill` when it owns skills. |
| `model` | no | agent | `sonnet` \| `opus` \| `haiku` \| id \| `inherit`. |
| `version` | no | skill | Skill version. |
| `crosscutting` | no | agent | `true` ⇒ a horizontal "slot" specialist — fanned into every scope agent's routing (attaches at root). |
| `slot` | no | agent | Display label for the standard zero a cross-cutting agent serves, e.g. `.00`. |

**Skill passthrough fields.** A skill note may also set any of the documented SKILL.md
frontmatter keys and they are copied into the generated skill verbatim (namespaced like
every other field — `vs-user-invocable` under a `vs-` prefix, etc.):
`when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`,
`allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `paths`,
`shell`. Anything else in the note's frontmatter (`tags`, `aliases`, dates, …) stays in
the vault and is **not** exported. Values must be scalars or lists of scalars — nested
values are dropped with a warning (`hooks` is excluded for the same reason).

⚠ With a **blank prefix**, these are bare top-level keys — a skill note using e.g.
`context:` or `paths:` for its *own* purposes would export that value with the Claude
Code meaning. If your vault's frontmatter vocabulary collides, set a field prefix.

## Field namespacing

Bare field names (`type`, `parent`, `description`, …) can collide with your vault's own
frontmatter. Pick a mode in the plugin settings — it only changes *where* the fields live;
the meanings and rules are identical:

- **prefix** (default) — a configurable prefix: `vs-type`, `vs-parent`, … **Leave the prefix
  blank** (the default) for bare top-level fields (`type`, `parent`, …); either way fields
  stay top-level, so the `parent` wikilink still gets Obsidian **backlinks and graph edges**.
- **nested** — everything under one key:
  ```yaml
  vault-skills:
    type: agent
    parent: "[[research]]"
  ```
  Cleanest, but a nested `parent` wikilink **may not** get backlinks/graph edges, and
  Obsidian's Properties UI won't edit nested objects. Prefer `prefix` if you navigate by link.

## Declaring the kind: `type` field vs tags

By default a note's **kind** (skill/agent/policy) comes from its `type` field. If you'd
rather drive it from Obsidian **tags**, set **Type source → tags** in the plugin settings.
Then a note is a skill/agent/policy when it carries the matching tag:

| Kind | Default tag (`tagPrefix` = `agent/`) | Blank prefix |
|---|---|---|
| skill | `#agent/skill` | `#skill` |
| agent | `#agent/agent` | `#agent` |
| policy | `#agent/policy` | `#policy` |

- The tag decides the **kind only**. `parent`, `description`, `name`, `tools`, … are still
  read from frontmatter through the field mode above — tags can't express a `[[wikilink]]`
  parent or a description.
- Kind tags are read from the note's frontmatter `tags:` (a list or a string), matched
  **case-insensitively** — body/inline `#tags` are ignored, so a note that merely mentions a
  kind tag in prose isn't classified. Set `tagPrefix` blank for bare `#skill`/`#agent`/`#policy`
  — but mind that those bare tags then collide with any everyday use of them, so a namespaced
  prefix (the `agent/` default) is safer.
- In tags mode any `type:` field is **ignored**; in the default frontmatter mode tags are
  ignored. It's one or the other, vault-wide.
- A note carrying **two** different kind tags (e.g. `#agent/skill` *and* `#agent/agent`) is
  skipped with a warning — tag it as exactly one.

The **Mark note as skill / agent / policy** command (and the `vault_skills_mark` MCP tool)
follow the mode: in tags mode they append the kind tag instead of writing `type:`.

## The three edges

Everything is one relationship — **`parent`** — read three ways:

- **Skill → owner.** A skill's `parent` is the agent that owns it. The exporter preloads
  the skill into that agent via `skills:` (its full body is injected at spawn).
- **Agent → delegator.** An agent's `parent` is the agent above it; the parent gets the
  `Agent` tool and a routing section so it can spawn this one (nested up to 5 levels).
- **No parent → level 0.** With strictly one parent, the way to **share** a skill across
  agents is to give it *no* `parent`: it lands at level 0, owned by the root and globally
  invokable. Level 0 is the only place a skill is reachable from everywhere.

## Cross-cutting agents (the horizontal axis)

Some agents own **one craft across every scope** — a surveyor, a triager — rather than a
lane. Mark one with **`crosscutting: true`** (optionally `slot: ".00"`, naming the standard
zero it serves). It attaches at the root but is **fanned into every scope agent's routing**
as a *Cross-cutting specialist*, so any agent can hand its slot work to it and pass its own
scope — the "cell": *survey **this** category*. Cross-cutting agents are kept out of the
normal delegate-to lanes, and every scope agent gets the `Agent` tool so it can reach them.

Delegation stays description-driven — a subagent already **sees every other agent's full
description**, so the injected block is just a short pointer (name + slot), not a copy. Keep
it reliable with two conventions:

- Open the description with **"Use PROACTIVELY to …"** (or `MUST BE USED when …`).
- One clear responsibility per agent.

The read/write posture is **mechanical**: grant a read-only specialist only `[Read, Grep,
Glob]` and it cannot write, whatever its prompt says.

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

## Supporting files (scripts, references)

A skill is one note — but skills often need more than markdown: helper scripts, reference
docs, templates. Those live in a **parallel filesystem tree** (the *Supporting-files tree*
setting; in a Johnny Decimal setup, typically `~/Documents` mirroring the vault's folder
structure). The mapping is by path: a skill note at

```
<vault>/60-69 Work/61.05 Agents & skills/skills/sessions.md
```

bundles everything under

```
<assetsRoot>/60-69 Work/61.05 Agents & skills/skills/sessions/
```

into the generated `skills/<name>/` directory, next to SKILL.md — subfolders, executable
bits and all. The skill body can then reference them the standard way:
`${CLAUDE_PLUGIN_ROOT}/skills/<name>/bin/tool.py`.

Notes: if the tree lives in iCloud Drive, evicted files are downloaded (`brctl download`)
before copying — a file that can't be materialized in time is skipped with a warning. A
supporting file named `SKILL.md` is ignored (the generated one wins). `.DS_Store` is
skipped. Bundled files are tracked in the export manifest, so they're cleaned up when the
note or folder goes away.

## Policy notes (shared context)

A **`type: policy`** note isn't emitted as a skill or agent — its **body is injected as
shared context into agents' prompts**. Its `parent` scopes *where* it applies:

- **no `parent`** ⇒ attaches at the root ⇒ injected into **every** agent (global);
- **`parent: [[some-agent]]`** ⇒ injected into that agent **and its whole subtree** only.

Multiple policies compose (broader, root-most ones first). Same parent rules as everything
else: a single wikilink to an **agent** — a list, or a parent that's a skill, is an error.

Use policy notes for the constants / conventions / operating rules every agent in a scope
should carry no matter what — house style, "prefer `vault-mcp`", "be conservative with
destructive edits", and so on. (There's no plugin-level system prompt in Claude Code and
subagents spawn fresh, so shared context has to be injected per-agent — which is what this
does.)

## Validation

The exporter reports (errors skip the node; warnings advise): unresolved `parent`, a
parent that's a skill, multiple parents, cycles, nodes that don't reach the root, and
agents past the 5-level nesting cap. Details in the spec.

## Authoring vs. runtime

These notes are the **source of truth**. The generated skills/agents (written to
`~/.claude/skills/vault-skills` by default) must **never** be hand-edited. Edit the note,
re-export from the **Vault Skills** Obsidian plugin — ribbon icon, the *Export skills &
agents to Claude Code* command, or the `vault_skills_export` MCP tool — then run
`/reload-plugins` in Claude Code.

## Versioned releases

The regular export targets your live load location. To publish the compiled plugin as a
versioned artifact, point the *Release repo directory* setting at a git checkout and run
the **Export release to repo** command (or the `vault_skills_release` MCP tool, which
takes `version` and an optional `dir`). It writes the identical full plugin there —
generated content, supporting files, static skills — and stamps your chosen version into
`.claude-plugin/plugin.json` (suggesting the next patch bump). It deliberately does
**not** touch git: review the diff, commit, and tag to publish.
