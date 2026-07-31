/**
 * Zintl Facets — Public API (`@zintljs/compiler/facets`)
 *
 * The concrete, framework-aware facet implementations. This is an **isolated
 * module graph**: the compiler core never imports from here. Knowledge flows one
 * way only —
 *
 *   extractor  ←  compiler (core)  ←  compiler/facets  ←  zintl (plugin)
 *
 * These presets are free to use compiler utilities (`IOManager`, hashing, …);
 * what they must not do is know how they were *selected* or how they *merge*.
 * Selection and resolution belong to the host plugin.
 *
 * This entry exports **values only**. The capability types live in the core and
 * are published from `@zintljs/compiler`; re-exporting them here too would emit a
 * second, structurally-identical-but-nominally-distinct declaration in
 * `dist/facet/index.d.mts`, and the two would not be assignable to each other.
 * That is what forced `as FacetsInput` casts on user facets.
 *
 * @example
 * import type { ZintlFacet } from "@zintljs/compiler";
 * import { reactFacet, viteFacet } from "@zintljs/compiler/facets";
 *
 * const facets: ZintlFacet[] = [...reactFacet(), viteFacet()];
 */

// Built-in preset facets
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

// What each preset accepts. These interfaces are declared here and nowhere
// else, so re-exporting them carries no risk of the duplicate-declaration
// problem described above — that applies only to the core capability types.
export type { VanillaFacetOptions } from "./presets/vanilla.js";
export type { ReactFacetOptions } from "./presets/react.js";
export type { VueFacetOptions } from "./presets/vue.js";
export type { SvelteFacetOptions } from "./presets/svelte.js";
export type { HtmlExtractionOptions, HtmlFacetOptions } from "./presets/html.js";
export type {
  NextjsExtractionOptions,
  NextjsSsrOptions,
  NextjsRuntimeOptions,
  NextjsFacetOptions,
} from "./presets/nextjs.js";
export type { SsrWrappingOptions, SsrRuntimeOptions, SsrFacetOptions } from "./presets/ssr.js";
export type { ClientSpaFacetOptions } from "./presets/client-spa.js";
export type { AssetFacetConfig } from "./presets/assets.js";
