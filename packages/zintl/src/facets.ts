/**
 * `zintl/facets` — the one-stop facet surface for plugin users.
 *
 * Preset values come from the compiler's isolated facets module; the capability
 * types come from the compiler core (they are declared exactly once, so user
 * facets stay assignable without casts); resolution comes from this package,
 * because deciding what the compiler will be is the plugin's job.
 */
export * from "@zintl/compiler/facets";
export type * from "@zintl/compiler";
export { resolveFacets } from "./facets/resolve.js";
export { assembleFacets, autoFacets, flattenFacets } from "./facets/assemble.js";
export {
  detectFrameworks,
  detectFrameworksOrFallback,
  FALLBACK_FRAMEWORK,
} from "./facets/detect.js";
export type { Framework } from "./facets/detect.js";
