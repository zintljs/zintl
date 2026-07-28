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

export { resolveFacets } from "./resolve.js";
export type * from "./types.js";
// Re-export for convenience — resolver types are also from resolve.ts
export type { ResolvedFacets } from "./resolve.js";

// Built-in preset facets (for programmatic use / testing)
export { vanillaFacet } from "./presets/vanilla.js";
export { reactExtractionFacet, reactCodegenFacet, reactFacet } from "./presets/react.js";
export { vueExtractionFacet, vueCodegenFacet, vueFacet } from "./presets/vue.js";
export { svelteExtractionFacet, svelteCodegenFacet, svelteFacet } from "./presets/svelte.js";
export { htmlExtractionFacet, htmlProjectionFacet, htmlFacet } from "./presets/html.js";
export {
  nextjsSsrFacet,
  nextjsExtractionFacet,
  nextjsRuntimeFacet,
  nextjsFacet,
} from "./presets/nextjs.js";
export { ssrWrappingFacet, ssrRuntimeFacet, ssrFacet } from "./presets/ssr.js";
export { clientSpaFacet } from "./presets/client-spa.js";
export { viteFacet } from "./presets/vite.js";
export { assetsFacet } from "./presets/assets.js";
