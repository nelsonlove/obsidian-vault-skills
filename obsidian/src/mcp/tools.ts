import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { App, TFile } from "obsidian";
import { ok, fail } from "./helpers.js";
import { analyzeVault, runExport, markFrontmatter, type FieldConfig } from "../exporter.js";
import { expandTilde } from "../paths.js";
import type { VaultSkillsSettings } from "../settings.js";

export interface ServerCtx {
  app: App;
  pluginVersion: string;
  getSettings: () => VaultSkillsSettings;
}

const fieldsOf = (s: VaultSkillsSettings): FieldConfig => ({ mode: s.fieldMode, prefix: s.fieldPrefix, key: s.fieldKey });
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RW = { readOnlyHint: false };

export function registerTools(server: McpServer, ctx: ServerCtx): void {
  const { app } = ctx;

  server.registerTool("vault_skills_validate", {
    title: "Validate the vault-skills tree",
    description: "Collect skill/agent/policy notes and run the transform without writing. Returns errors, warnings, and counts. Read-only.",
    inputSchema: {},
    annotations: RO,
  }, async () => {
    try {
      const s = ctx.getSettings();
      const a = await analyzeVault(app, fieldsOf(s), s.pluginName);
      return ok({ ok: a.errors.length === 0, errors: a.errors, warnings: a.warnings, counts: a.counts });
    } catch (e) { return fail(e); }
  });

  server.registerTool("vault_skills_tree", {
    title: "Show the vault-skills tree",
    description: "Return the current agent/skill hierarchy (name, kind, parent, level, owned skills, children). Read-only.",
    inputSchema: {},
    annotations: RO,
  }, async () => {
    try {
      const s = ctx.getSettings();
      const a = await analyzeVault(app, fieldsOf(s), s.pluginName);
      return ok({ tree: a.tree, counts: a.counts });
    } catch (e) { return fail(e); }
  });

  server.registerTool("vault_skills_export", {
    title: "Export the Claude Code plugin",
    description: "Write skills/agents to the configured output dir. Then run /reload-plugins in Claude Code to load. Mutating.",
    inputSchema: {},
    annotations: RW,
  }, async () => {
    try {
      const s = ctx.getSettings();
      const summary = await runExport(app, { outputDir: expandTilde(s.outputDir), pluginName: s.pluginName, fields: fieldsOf(s) });
      return ok({
        skills: summary.skills, agents: summary.agents, removed: summary.removed,
        errors: summary.errors, warnings: summary.warnings, outputDir: summary.outputDir,
        note: "Run /reload-plugins in Claude Code to load the changes.",
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool("vault_skills_mark", {
    title: "Mark a note as skill / agent / policy",
    description: "Set the vault-skills frontmatter on an existing note (honoring the field mode). Does not create the note or apply house style. Mutating.",
    inputSchema: {
      path: z.string().min(1).describe("Vault-relative path of the note to mark."),
      type: z.enum(["skill", "agent", "policy"]),
      parent: z.string().optional().describe("Parent agent basename or [[wikilink]]; omit for root."),
      description: z.string().optional(),
    },
    annotations: RW,
  }, async ({ path: p, type, parent, description }) => {
    try {
      const s = ctx.getSettings();
      const file = app.vault.getAbstractFileByPath(p);
      if (!file || !("extension" in file)) return fail(new Error(`not found: ${p}`));
      const patch = markFrontmatter({ type, parent, description }, fieldsOf(s));
      await app.fileManager.processFrontMatter(file as TFile, (fm: Record<string, unknown>) => { Object.assign(fm, patch); });
      return ok({ marked: p, type, parent: parent ?? null });
    } catch (e) { return fail(e); }
  });
}
