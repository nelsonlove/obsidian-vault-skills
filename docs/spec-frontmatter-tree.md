# Spec: frontmatter tree model

Replaces folder/Johnny-Decimal-derived structure with an explicit **frontmatter tree**.
A note declares its `type` and a single `parent`; the exporter builds a strict tree,
validates its edges, and compiles it into the wired Claude Code plugin (each agent owns
its skills; `root → … → leaf` delegation). Folders become purely organizational.

## Discovery

- A note is a candidate iff frontmatter `type` ∈ {`skill`, `agent`, `policy`}.
- Location in the vault is irrelevant to structure.
- Fields may be **prefixed** (`<prefix>type`; the default prefix is blank ⇒ bare top-level
  `type`/`parent`/…) or **nested** under one key — a settings choice. The exporter normalizes
  them to a plain view before the transform, so every rule below is identical regardless of mode.

## Frontmatter fields

| Field | Req | Applies | Meaning |
|---|---|---|---|
| `type` | **yes** | all | `skill`, `agent`, or `policy`. |
| `parent` | no¹ | all | A **single** `[[wikilink]]` to the parent **agent**. Omit ⇒ parent is the root. A **list ⇒ error** (strict single parent). For a `policy`, `parent` scopes where it applies (see Compilation). |
| `root` | no | agent | `true` marks the one root agent. |
| `description` | rec | both | Trigger text. |
| `name` | no | both | Base name override (default: filename slug). |
| `id` | no | both | Name-prefix override, e.g. `56` → `56-<slug>`. Default: no prefix. |
| `label` | no | both | Display label used in breadcrumbs (default: name). |
| `tools` | no | agent | Tool allowlist; `Agent` appended automatically if it has child agents. |
| `model` | no | agent | Model. |
| `version` | no | skill | Skill version. |
| `crosscutting` | no | agent | `true` ⇒ horizontal slot agent; fanned into every scope agent's routing, excluded from vertical lanes. |
| `slot` | no | agent | Display-only standard-zero label for a cross-cutting agent, e.g. `.00`. |
| *passthrough* | no | skill | The documented SKILL.md keys `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `paths`, `shell` are copied into the generated SKILL.md verbatim (same namespacing as all fields). All other frontmatter is ignored. `hooks` is not passed through (nested YAML). |

¹ Omitting `parent` means "child of the root" — it is not an error.

## Tree construction

1. Parse candidates into nodes keyed by note path.
2. Resolve each `parent` wikilink to a target note **path** (Obsidian resolves; the pure
   transform receives resolved paths).
3. **Root** = the node with `root: true`. If none → **synthesize** a `vault` root agent
   (level 0). If more than one → error on the extras, first wins.
4. Each non-root node's parent = its resolved parent node, or the root if `parent` omitted.
5. **Level** = distance from root (root = 0). Not declared; computed.

## Strict single parent + shared-skill rule

- `parent` must resolve to **exactly one agent**. A list, or multiple resolutions, is an
  **error** (node skipped + warning).
- There is **no multi-parent**. To share a skill across agents, give it **no parent** ⇒ it
  lands at **level 0**, owned by the root. Level-0 skills are universal: preloaded into the
  root and globally invokable by any agent (a plugin's skills are a global namespace). This
  is the *only* sharing mechanism — single-parent structurally enforces it.

## Validation pass

Errors skip the node and warn; warnings advise.

1. **Resolves** — unresolved `parent` wikilink ⇒ error.
2. **Parent is an agent** — parent resolves to a skill ⇒ error.
3. **Single parent** — list / >1 resolution ⇒ error.
4. **One root** — 0 ⇒ synthesize; >1 ⇒ error on extras (first wins).
5. **Acyclic** — a cycle in the parent chain ⇒ error (cycle members skipped).
6. **Depth ≤ 5** — an agent at level > 4 ⇒ warn (delegation past the depth-5 nested-subagent
   cap won't spawn). Skills don't count toward depth.
7. **Reachable** — a node whose chain doesn't reach the root ⇒ error.

## Compilation

- **Name** = `id ? "<id>-<slug>" : "<slug>"` of `name || filename`, deduped (`-2`, `-3`, …).
- **Breadcrumb** = `label`s of ancestor agents from just-below-root down to the parent,
  joined ` › ` (omitted at level ≤ 1). **Description** = `[<breadcrumb>] <rawDesc>`.
- **Skill** → `skills/<name>/SKILL.md` (global namespace).
- **Agent** → `agents/<name>.md`:
  - `skills:` = namespaced refs (`<plugin>:<name>`) of skills whose parent is this agent.
  - `tools` = authored tools (+ `Agent` when it has child agents).
  - Delegation set = agents whose parent is this agent.
  - Body += a **Vault access** line (vault path), any applicable **policy** bodies (see
    below), a **Skills** note (what's preloaded), and a routing section — **Vault routing**
    for the root, **Delegates to** for others — listing children by their **namespaced
    subagent name** (`<plugin>:<name>`) so a parent delegates first-try via the Agent tool.
- **Synthesized root**: name `vault`, generic router body, owns level-0 skills, delegates
  to level-1 agents.

### Supporting files (assets)

When the *Supporting-files tree* setting (`assetsRoot`) is set, each skill note at
`<dir>/<base>.md` bundles the contents of `<assetsRoot>/<dir>/<base>/` (recursively,
preserving file modes) into its generated `skills/<name>/` directory:

- iCloud placeholders (`.<name>.icloud`) are materialized via `brctl download` first;
  files that don't materialize within the timeout are skipped with a **warning**.
- A supporting file named `SKILL.md` is skipped with a warning (generated file wins).
- `.DS_Store` is skipped.
- Bundled files are recorded in `.vault-skills-manifest.json`, so a later export without
  them removes them like any stale generated file.

### Release export

An export may carry an explicit `version`: identical output, plus the version is stamped
into the target's `.claude-plugin/plugin.json` (created if absent, updated in place —
other manifest fields preserved). Surfaced as the **Export release to repo** command
(target = the *Release repo directory* setting; prompts with the next patch bump) and the
`vault_skills_release` MCP tool (`version`, optional `dir`). Git operations (commit, tag,
push) are intentionally out of scope.

### Policy notes (shared context)

A `type: policy` note is not emitted as a file. Its `parent` is resolved like any node's
(single wikilink to an agent; omit ⇒ root). Its body is injected into the prompt of **every
agent in its parent's subtree** (root ⇒ all agents). For each agent, applicable policy
bodies are gathered along its ancestor-or-self chain, root-most first, and appended after
the Vault-access line. Validation: multiple parents, an unresolved parent, or a parent that
isn't a valid agent ⇒ error (the policy is dropped).

## Horizontal axis (cross-cutting agents)

`crosscutting: true` marks an agent a horizontal **slot** specialist (optional `slot` labels the
standard zero it serves). Layered on the vertical tree:

- It keeps a `parent` (for validity/level) but is **excluded from that parent's `children`**, so it
  never renders as a vertical delegate-to lane.
- The set of all crosscutting agents is **fanned into every non-crosscutting agent's body** as a
  *Cross-cutting specialists* block — a compact pointer (`<plugin>:<name> (<slot>)`), not the full
  descriptions (a subagent already sees those). The block names the agent's own scope so the callee
  can be told which lane to act on (the "cell").
- Any agent with a non-empty crosscutting set gets the `Agent` tool, so even leaves can delegate.
- `TreeNode.crosscutting` surfaces the flag.

## MCP server

The plugin also serves its own MCP server (`vault-skills`, over a Unix socket + embedded
stdio bridge, auto-registered with Claude Code via `claude mcp add`), so an agent can drive
the same cores without the Obsidian UI:

- `vault_skills_validate` — errors/warnings/counts (read-only)
- `vault_skills_tree` — the current hierarchy (read-only)
- `vault_skills_export` — write the plugin to the output dir (then `/reload-plugins`)
- `vault_skills_release` — package a versioned release into a repo checkout
- `vault_skills_mark` — set the vault-skills fields on an existing note by path

State (socket, discovery, bridge) lives in `~/.claude/vault-skills-mcp/`.

## Removed vs. the JD model

`scope`, JD path parsing, area/category terminology, the levels/regex config, and
`delegates-to` (superseded by `parent`). The tree is fully defined by `parent` + `root`.

## Depth note

Levels 0–4 = agent depths 1–5 below the main conversation = exactly the nested-subagent
cap. Level 4 is the deepest that still spawns; deeper agents preload/exist but can't be
reached by live delegation.
