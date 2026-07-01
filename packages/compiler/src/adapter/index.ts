/**
 * Zintl Adapter System — Public API
 *
 * The adapter system decouples framework-specific behavior from the compiler core.
 * Adapters are composable, per-concern units. Multiple adapters combine to form
 * the resolved system behavior.
 *
 * @example
 * import { resolveAdapters } from "@zintl/compiler/adapter";
 *
 * const resolved = resolveAdapters(["react", "vite", "client-spa"]);
 * // resolved.capabilities.jsx === true
 * // resolved.capabilities.hmr === true
 * // resolved.capabilities.clientLocaleSync === true
 */

// Bootstrap all built-in presets (side-effects register them with the engine)
import "./presets/index.js";

export { resolveAdapters, registerPreset } from "./resolve.js";
export type {
  ZintlAdapter,
  ZintlPreset,
  ZintlAdapterInput,
  BaseContribution,
  ExtractionContribution,
  CodegenContribution,
  SsrContribution,
  RuntimeContribution,
  BundlerContribution,
  ContentContribution,
  ResolvedCapabilities,
  MergedAdapterHooks,
  SsrWrapParams,
  LocaleDetectionContext,
  MultiplexDetectionContext,
  TagMapEntry,
  CompilerContext,
} from "./types.js";
// Re-export for convenience — resolver types are also from resolve.ts
export type { ResolvedAdapters, ResolvedCompilerState } from "./resolve.js";

// Built-in preset adapters (for programmatic use / testing)
export { vanillaExtractionAdapter } from "./presets/vanilla.js";
export { reactExtractionAdapter, reactCodegenAdapter } from "./presets/react.js";
export { vueExtractionAdapter, vueCodegenAdapter } from "./presets/vue.js";
export { svelteExtractionAdapter, svelteCodegenAdapter } from "./presets/svelte.js";
export { htmlExtractionAdapter, createHtmlProjectionAdapter } from "./presets/html.js";
export { nextjsSsrAdapter } from "./presets/nextjs.js";
export { ssrRuntimeAdapter } from "./presets/ssr.js";
export { clientSpaRuntimeAdapter } from "./presets/client-spa.js";
export { viteBundlerAdapter } from "./presets/vite.js";
export { createAssetAdapter } from "./presets/assets.js";
