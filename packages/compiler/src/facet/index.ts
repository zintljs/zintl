/**
 * Zintl Facet System — Public API
 *
 * The facet system decouples framework-specific behavior from the compiler core.
 * Facets are composable, per-concern units. Multiple facets combine to form
 * the resolved system behavior.
 *
 * @example
 * import { resolveFacets } from "@zintl/compiler/facet";
 *
 * const resolved = resolveFacets(["react", "vite", "client-spa"]);
 * // resolved.capabilities.jsx === true
 * // resolved.capabilities.hmr === true
 * // resolved.capabilities.clientLocaleSync === true
 */

// Bootstrap all built-in presets (side-effects register them with the engine)
import "./presets/index.js";

export { resolveFacets, registerPreset } from "./resolve.js";
export type {
  ZintlFacet,
  ZintlFacetInput,
  FacetConcern,
  BaseFacet,
  ExtractionFacet,
  CodegenFacet,
  SsrFacet,
  RuntimeFacet,
  BundlerFacet,
  ContentFacet,
  ResolvedCapabilities,
  ResolvedFacetSystem,
  SsrWrapParams,
  LocaleDetectionContext,
  MultiplexDetectionContext,
  TagMapEntry,
  CompilerContext,
} from "./types.js";
// Re-export for convenience — resolver types are also from resolve.ts
export type { ResolvedFacets } from "./resolve.js";

// Built-in preset facets (for programmatic use / testing)
export { vanillaExtractionFacet } from "./presets/vanilla.js";
export { reactExtractionFacet, reactCodegenFacet } from "./presets/react.js";
export { vueExtractionFacet, vueCodegenFacet } from "./presets/vue.js";
export { svelteExtractionFacet, svelteCodegenFacet } from "./presets/svelte.js";
export { htmlExtractionFacet, createHtmlProjectionFacet } from "./presets/html.js";
export { nextjsSsrFacet } from "./presets/nextjs.js";
export { ssrRuntimeFacet } from "./presets/ssr.js";
export { clientSpaRuntimeFacet } from "./presets/client-spa.js";
export { viteBundlerFacet } from "./presets/vite.js";
export { createAssetFacet } from "./presets/assets.js";
