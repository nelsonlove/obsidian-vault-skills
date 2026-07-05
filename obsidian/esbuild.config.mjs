import esbuild from "esbuild";
import * as fs from "node:fs";

const production = process.argv.includes("production");

// Obsidian and Node built-ins are provided by the host; never bundle them.
const external = [
  "obsidian", "electron",
  "@codemirror/state", "@codemirror/view", "@lezer/common",
  "node:fs", "node:os", "node:path",
];

// Static skills shipped inside the plugin, embedded at build time (src/static-skills.ts
// reads these defines). The exporter emits them into the output dir on each export.
const newSkillMd = fs.readFileSync("assets/new-skill/SKILL.md", "utf8");

const plugin = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  external,
  define: { __NEW_SKILL_MD__: JSON.stringify(newSkillMd) },
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
};

if (production) {
  await esbuild.build(plugin);
} else {
  const ctx = await esbuild.context(plugin);
  await ctx.watch();
}
