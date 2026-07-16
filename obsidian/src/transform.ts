// Pure vault → Claude Code plugin transform (frontmatter tree model).
//
// A note declares `type` (skill|agent) and a single `parent` ([[wikilink]], resolved to a
// path by the caller). The exporter builds a strict tree, validates its edges, and compiles
// it: each agent owns the skills whose parent is it (preloaded via `skills:`) and delegates
// to the agents whose parent is it. See docs/spec-frontmatter-tree.md.
//
// `type: command` notes are flat — they take no part in the tree (no parent, no ownership) and
// emit a Claude Code slash command at `commands/<name>.md`. `type: policy` bodies are injected
// into agents.
//
// No `obsidian`/`fs` imports — unit-testable. Parent wikilinks are resolved to note paths by
// exporter.ts (Obsidian); this module works purely on those paths.

/** Tree kinds — participate in the parent/ownership tree. */
export type Kind = "skill" | "agent";
/** Everything the transform emits as a file (commands are flat, outside the tree). */
export type EmittedKind = Kind | "command";

export interface NoteInput {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Resolved parent note path(s). 0 ⇒ child of root; 1 ⇒ that parent; >1 ⇒ error. */
  parentPaths: string[];
}

export interface Generated {
  kind: EmittedKind;
  relOut: string;
  content: string;
  from: string;
}

export interface TransformOptions {
  pluginName: string;
  synthesizeRoot?: boolean;
  /** Absolute vault path, baked into each agent so it can read/write the vault. */
  vaultPath?: string;
}

export interface TreeNode {
  name: string;            // generated name
  kind: Kind;              // agent | skill
  parent: string | null;  // parent agent's generated name (null for the root)
  level: number;
  skills: string[];        // owned skills' generated names (agents only)
  children: string[];      // child agents' generated names (agents only)
  crosscutting: boolean;   // horizontal slot agent (fanned into scope agents' routing)
}

export interface TransformResult {
  generated: Generated[];
  warnings: string[];
  errors: string[];
  tree: TreeNode[];
}

interface Node {
  kind: Kind;
  path: string;
  isRoot: boolean;
  parentPaths: string[];
  nameBase: string;
  id?: string;
  label: string;
  rawDesc: string;
  version?: string;
  tools?: string[];
  model?: string;
  crosscutting: boolean;
  slot?: string;
  extra: Record<string, unknown>;
  body: string;
  // resolved:
  parent: Node | null;
  children: Node[];
  ownedSkills: Node[];
  level: number;
  genName: string;
  valid: boolean;
}

interface Policy {
  path: string;
  parentPaths: string[];
  body: string;
}

interface Command {
  path: string;
  nameBase: string;
  rawDesc: string;
  extra: Record<string, unknown>;
  body: string;
  genName: string;
}

const SYNTH_ROOT_PATH = " synth-root";

/** Documented SKILL.md frontmatter keys passed through verbatim from a skill note
 *  (Claude Code silently ignores unknown keys, so this is a curated allowlist rather
 *  than pass-everything — it keeps Obsidian housekeeping fields like `tags`/`aliases`
 *  out of the generated skill). `hooks` is excluded: it is a nested object and the
 *  flat YAML emitter here deliberately doesn't render nesting. */
export const SKILL_PASSTHROUGH_FIELDS = [
  "when_to_use", "argument-hint", "arguments",
  "disable-model-invocation", "user-invocable",
  "allowed-tools", "disallowed-tools",
  "model", "effort", "context", "agent", "paths", "shell",
] as const;

/** Claude Code slash-command frontmatter keys passed through verbatim from a `type: command`
 *  note (`description` is handled separately). Curated allowlist, same rationale as
 *  SKILL_PASSTHROUGH_FIELDS — keep Obsidian housekeeping fields out of the emitted command. */
export const COMMAND_PASSTHROUGH_FIELDS = [
  "argument-hint", "allowed-tools", "disallowed-tools", "model",
] as const;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Passthrough values must survive the flat YAML emitter: scalars and arrays of scalars only. */
const isScalar = (x: unknown): boolean => ["string", "number", "boolean"].includes(typeof x);

/** Collect an allowlisted set of frontmatter keys that are scalar (or scalar lists); anything
 *  nested is dropped with a warning, since the flat YAML emitter can't render it. */
function passthrough(
  fm: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  warnings: string[],
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const f of keys) {
    const v = fm[f];
    if (v == null) continue;
    if (isScalar(v) || (Array.isArray(v) && v.every(isScalar))) extra[f] = v;
    else warnings.push(`${path}: passthrough field \`${f}\` has a nested value — dropped (only scalars and lists of scalars are exported)`);
  }
  return extra;
}

/** Description fallback shared by skills/agents and commands: the note's `description`, else the
 *  name humanized (dashes → spaces). `nameBase` is the already-slugged name, so this reuses it
 *  rather than re-slugging. */
function descFallback(fm: Record<string, unknown>, nameBase: string): string {
  return (str(fm.description) || nameBase.replace(/-/g, " ")).trim();
}

/** Uniquify `base` against `used` (mutated), appending `-2`, `-3`, … on collision. Shared by the
 *  tree-node and command naming passes so both dedup the same `/plugin:<name>` namespace identically. */
function uniqueName(base: string, used: Set<string>): { name: string; collided: boolean } {
  const collided = used.has(base);
  let name = base, k = 2;
  while (used.has(name)) name = `${base}-${k++}`;
  used.add(name);
  return { name, collided };
}

function toolsArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return undefined;
}

export function slug(s: string): string {
  return String(s).toLowerCase().trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toYaml(obj: Record<string, unknown>): string {
  const out = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) {
      const items = v.map(String);
      // Flow style is only safe when no item needs quoting; a comma inside an unquoted
      // flow item would split it into two on parse.
      if (items.some((e) => /[:#,]/.test(e))) {
        out.push(`${k}:`);
        for (const e of items) out.push(`  - ${/[:#"'\n,]/.test(e) ? JSON.stringify(e) : e}`);
      } else {
        out.push(`${k}: [${items.join(", ")}]`);
      }
    } else if (typeof v === "string") {
      const plain = /^[A-Za-z0-9][\w .,/()&-]*$/.test(v);
      out.push(`${k}: ${plain ? v : JSON.stringify(v)}`);
    } else out.push(`${k}: ${String(v)}`);
  }
  out.push("---");
  return out.join("\n");
}

function provenanceFor(from: string): string {
  return `<!-- generated by obsidian-vault-skills from vault note: ${from}\n     Do not edit here — edit the source note and re-export. -->`;
}

function fileBaseOf(path: string): string {
  return (path.split("/").pop() ?? "").replace(/\.md$/, "");
}

export function transformAll(notes: NoteInput[], opts: TransformOptions): TransformResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // ---- phase 1: parse candidate nodes ----
  const nodes: Node[] = [];
  const policies: Policy[] = [];
  const commands: Command[] = [];
  for (const note of notes) {
    const fm = note.frontmatter || {};
    if (fm.type === "policy") {
      policies.push({ path: note.path, parentPaths: note.parentPaths ?? [], body: note.body.trim() });
      continue;
    }
    if (fm.type === "command") {
      // Flat: commands take no part in the tree — no parent, no ownership. `name` (or the
      // filename) becomes the slash-command name; the body is the prompt template.
      const nameBase = slug(str(fm.name) || fileBaseOf(note.path));
      commands.push({
        path: note.path,
        nameBase,
        rawDesc: descFallback(fm, nameBase),
        extra: passthrough(fm, COMMAND_PASSTHROUGH_FIELDS, note.path, warnings),
        body: note.body.trim(),
        genName: "",
      });
      continue;
    }
    const kind: Kind | null = fm.type === "agent" ? "agent" : fm.type === "skill" ? "skill" : null;
    if (!kind) continue;
    const fileBase = fileBaseOf(note.path);
    const extra = kind === "skill" ? passthrough(fm, SKILL_PASSTHROUGH_FIELDS, note.path, warnings) : {};
    const nameBase = slug(str(fm.name) || fileBase);
    nodes.push({
      kind,
      path: note.path,
      isRoot: fm.root === true,
      parentPaths: note.parentPaths ?? [],
      nameBase,
      id: str(fm.id),
      label: str(fm.label) || str(fm.name) || fileBase,
      rawDesc: descFallback(fm, nameBase),
      version: str(fm.version),
      tools: toolsArray(fm.tools),
      model: str(fm.model),
      crosscutting: fm.crosscutting === true,
      slot: str(fm.slot),
      extra,
      body: note.body.trim(),
      parent: null, children: [], ownedSkills: [], level: -1, genName: "", valid: true,
    });
  }
  const byPath = new Map(nodes.map((n) => [n.path, n]));

  // ---- phase 2: root ----
  const declaredRoots = nodes.filter((n) => n.isRoot);
  for (const r of declaredRoots) {
    if (r.kind !== "agent") { r.valid = false; errors.push(`${r.path}: root must be an agent`); }
  }
  const validRoots = declaredRoots.filter((r) => r.valid);
  for (const extra of validRoots.slice(1)) { extra.valid = false; errors.push(`${extra.path}: multiple roots; ignoring this one`); }
  let root: Node | null = validRoots[0] ?? null;
  if (!root && opts.synthesizeRoot !== false) {
    root = {
      kind: "agent", path: SYNTH_ROOT_PATH, isRoot: true, parentPaths: [],
      nameBase: "vault", label: "Vault",
      rawDesc: "General vault agent — routes each request to the appropriate sub-agent.",
      extra: {},
      body: "You are the general agent for this vault. Understand each request and delegate to the appropriate sub-agent; coordinate across sub-agents yourself when a request spans several.",
      crosscutting: false, parent: null, children: [], ownedSkills: [], level: 0, genName: "", valid: true,
    };
    nodes.unshift(root);
    byPath.set(root.path, root);
  }
  if (root) root.level = 0;

  // ---- phase 3: resolve each node's parent ----
  for (const n of nodes) {
    if (n === root) continue;
    if (n.parentPaths.length > 1) { n.valid = false; errors.push(`${n.path}: multiple parents (strict single-parent)`); continue; }
    if (n.parentPaths.length === 0) {
      if (!root) { n.valid = false; errors.push(`${n.path}: no parent and no root`); continue; }
      n.parent = root; continue;
    }
    const parent = byPath.get(n.parentPaths[0]);
    if (!parent) { n.valid = false; errors.push(`${n.path}: unresolved parent ${n.parentPaths[0]}`); continue; }
    if (parent.kind !== "agent") { n.valid = false; errors.push(`${n.path}: parent is not an agent`); continue; }
    n.parent = parent;
  }

  // ---- phase 4: validate reachability / cycles / depth; compute level ----
  for (const n of nodes) {
    if (!n.valid || n === root) continue;
    const seen = new Set<string>([n.path]);
    let cur: Node | null = n.parent;
    let steps = 1;
    while (cur && !cur.isRoot) {
      if (seen.has(cur.path) || !cur.valid) { n.valid = false; break; }
      seen.add(cur.path);
      cur = cur.parent;
      steps++;
    }
    if (!n.valid) { errors.push(`${n.path}: broken parent chain (cycle or invalid ancestor)`); continue; }
    if (!cur) { n.valid = false; errors.push(`${n.path}: parent chain does not reach the root`); continue; }
    n.level = steps;
    if (n.kind === "agent" && n.level > 4) warnings.push(`${n.path}: agent at level ${n.level} exceeds the depth-5 nesting cap and won't be reachable by live delegation`);
  }

  // ---- phase 5: wire children + ownership from valid nodes ----
  for (const n of nodes) {
    if (!n.valid || n === root || !n.parent) continue;
    if (n.kind === "agent") { if (!n.crosscutting) n.parent.children.push(n); }
    else n.parent.ownedSkills.push(n);
  }

  // ---- resolve policy notes: attach each to the agent whose subtree it governs ----
  // (no parent ⇒ root ⇒ applies to every agent; strict single parent, must be an agent).
  const policyBodiesByNode = new Map<string, string[]>();
  for (const pol of policies) {
    let parent: Node | null;
    if (pol.parentPaths.length > 1) { errors.push(`${pol.path}: policy has multiple parents (strict single-parent)`); continue; }
    else if (pol.parentPaths.length === 0) parent = root;
    else parent = byPath.get(pol.parentPaths[0]) ?? null;
    if (!parent) { errors.push(`${pol.path}: policy has an unresolved or missing parent`); continue; }
    if (parent.kind !== "agent") { errors.push(`${pol.path}: policy parent is not an agent`); continue; }
    if (!parent.valid) { errors.push(`${pol.path}: policy parent is invalid`); continue; }
    const arr = policyBodiesByNode.get(parent.path) ?? [];
    arr.push(pol.body);
    policyBodiesByNode.set(parent.path, arr);
  }
  // Policies governing an agent = those attached to any ancestor-or-self, root-most first.
  const applicablePolicies = (n: Node): string[] => {
    const chain: Node[] = [];
    for (let cur: Node | null = n; cur; cur = cur.parent) chain.unshift(cur);
    return chain.flatMap((node) => policyBodiesByNode.get(node.path) ?? []);
  };

  // ---- phase 6: names (dedup) ----
  const used = new Set<string>();
  for (const n of nodes) {
    if (!n.valid) continue;
    const base = n.id ? `${n.id}-${n.nameBase}` : n.nameBase;
    n.genName = uniqueName(base, used).name;
  }
  // Commands share the /plugin:<name> namespace with skills, so dedup against the same set —
  // a command and a skill both named `foo` would otherwise both claim `/plugin:foo`.
  for (const c of commands) {
    if (!c.nameBase) { errors.push(`${c.path}: command has an empty name — set a \`name:\` or give the note a filename with alphanumerics`); continue; }
    const { name, collided } = uniqueName(c.nameBase, used);
    if (collided) warnings.push(`${c.path}: command name \`${c.nameBase}\` collides with an existing skill/agent/command — renamed to \`${name}\``);
    c.genName = name;
  }

  const breadcrumb = (n: Node): string => {
    const labels: string[] = [];
    let cur = n.parent;
    while (cur && !cur.isRoot) { labels.unshift(cur.label); cur = cur.parent; }
    return labels.join(" › ");
  };
  const describe = (n: Node): string => {
    const bc = breadcrumb(n);
    return bc ? `[${bc}] ${n.rawDesc}` : n.rawDesc;
  };

  const scopeOf = (n: Node): string =>
    n.isRoot ? "the whole vault" : (breadcrumb(n) ? `${breadcrumb(n)} › ${n.label}` : n.label);
  const crosscut = nodes.filter((n) => n.valid && n.kind === "agent" && n.crosscutting);

  // ---- phase 7: render ----
  const generated: Generated[] = [];
  for (const n of nodes) {
    if (!n.valid) continue;

    if (n.kind === "skill") {
      const fmOut = toYaml({ name: n.genName, description: describe(n), version: n.version, ...n.extra });
      generated.push({ kind: "skill", relOut: `skills/${n.genName}/SKILL.md`, from: n.path,
        content: `${fmOut}\n\n${provenanceFor(n.path)}\n\n${n.body}\n` });
      continue;
    }

    // agent — guarantee structural tools from tree position (Agent to delegate, Skill to
    // invoke owned skills). Only matters when tools are explicitly listed; omitting tools
    // inherits everything.
    let tools = n.tools;
    if ((n.children.length || (crosscut.length && !n.crosscutting)) && tools && !tools.includes("Agent")) tools = [...tools, "Agent"];
    if (n.ownedSkills.length && tools && !tools.includes("Skill")) tools = [...tools, "Skill"];
    const skillRefs = n.ownedSkills.map((s) => `${opts.pluginName}:${s.genName}`);
    const fmOut = toYaml({ name: n.genName, description: describe(n), tools, model: n.model, skills: skillRefs });

    let bodyOut = n.body;
    if (opts.vaultPath) {
      bodyOut += `\n\n## Vault access\n\nYour skills and agents are authored in the Obsidian vault at \`${opts.vaultPath}\`. You can read and write notes there directly (Read/Grep/Glob and Write/Edit under that path), or use the \`vault-mcp\` tools if connected.`;
    }
    const policyBodies = applicablePolicies(n);
    if (policyBodies.length) {
      bodyOut += `\n\n${policyBodies.join("\n\n")}`;
    }
    if (skillRefs.length) {
      bodyOut += `\n\n## Skills\n\nThese scope skills are preloaded into your context — use them for work in this scope: ${skillRefs.map((s) => `\`${s}\``).join(", ")}.`;
    }
    if (n.children.length) {
      const items = n.children.map((c) => `- \`${opts.pluginName}:${c.genName}\` — ${c.label}`);
      const heading = n.isRoot
        ? "## Vault routing\n\nYou are the general vault agent. Identify which sub-agent a request belongs to and delegate to it via the Agent tool (nested subagents work up to 5 levels deep):"
        : "## Delegates to\n\nDelegate sub-scope work to the matching agent via the Agent tool:";
      bodyOut += `\n\n${heading}\n${items.join("\n")}`;
    }
    if (crosscut.length && !n.crosscutting) {
      const specialists = crosscut.map((c) => `- \`${opts.pluginName}:${c.genName}\`${c.slot ? ` (${c.slot})` : ""}`);
      bodyOut += `\n\n## Cross-cutting specialists\n\nFor single-craft work on a standard-zero slot of your scope (${scopeOf(n)}), prefer the matching specialist and tell it which scope to work on — their full descriptions are already visible to you. Delegate via the Agent tool:\n${specialists.join("\n")}`;
    }

    const src = n.path === SYNTH_ROOT_PATH ? "(synthesized root)" : n.path;
    generated.push({ kind: "agent", relOut: `agents/${n.genName}.md`, from: src,
      content: `${fmOut}\n\n${provenanceFor(src)}\n\n${bodyOut}\n` });
  }

  // ---- commands (flat): emit a Claude Code slash command per note ----
  for (const c of commands) {
    if (!c.genName) continue; // empty-name command errored above, nothing to emit
    // No name/breadcrumb in the frontmatter: the slash-command name is the filename, and a
    // command has no scope in the tree. Body is the prompt template ($ARGUMENTS, !bash, @file).
    const fmOut = toYaml({ description: c.rawDesc, ...c.extra });
    generated.push({ kind: "command", relOut: `commands/${c.genName}.md`, from: c.path,
      content: `${fmOut}\n\n${provenanceFor(c.path)}\n\n${c.body}\n` });
  }

  const tree: TreeNode[] = nodes.filter((n) => n.valid).map((n) => ({
    name: n.genName,
    kind: n.kind,
    parent: n.parent ? n.parent.genName : null,
    level: n.level,
    skills: n.ownedSkills.map((s) => s.genName),
    children: n.children.map((c) => c.genName),
    crosscutting: n.crosscutting,
  }));

  return { generated, warnings, errors, tree };
}
