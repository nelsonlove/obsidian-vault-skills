import esbuild from "esbuild";

const production = process.argv.includes("production");

// Obsidian and Node built-ins are provided by the host; never bundle them.
const external = [
  "obsidian", "electron",
  "@codemirror/state", "@codemirror/view", "@lezer/common",
  "node:fs", "node:os", "node:path",
];

const plugin = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  external,
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
