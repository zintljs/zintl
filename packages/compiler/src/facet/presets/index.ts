/**
 * Preset registry bootstrapper.
 * Importing this file registers all built-in presets with the resolution engine.
 * Must be imported before resolveFacets() is called.
 */

// Each import triggers registerPreset() as a side-effect
export * from "./vanilla.js";
export * from "./react.js";
export * from "./vue.js";
export * from "./svelte.js";
export * from "./html.js";
export * from "./nextjs.js";
export * from "./ssr.js";
export * from "./client-spa.js";
export * from "./vite.js";
export * from "./assets.js";
