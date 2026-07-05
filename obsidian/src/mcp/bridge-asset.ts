// The stdio bridge source, embedded at build time by esbuild (see esbuild.config.mjs).
// Empty under tsx (tests) where the define is absent.
declare const __VS_BRIDGE_SOURCE__: string;
export const BRIDGE_SOURCE: string = typeof __VS_BRIDGE_SOURCE__ !== "undefined" ? __VS_BRIDGE_SOURCE__ : "";
