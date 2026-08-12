/**
 * @module zintl/facets
 *
 * Facets — the composable units the compiler's behavior is assembled from.
 *
 * Most projects never import from here: `facets: ["builtins"]` detects the framework
 * and installs the right presets. Reach for this entry to pin a preset
 * explicitly, or to write a facet of your own for a file type or framework Zintl
 * does not know about.
 *
 * Each facet owns exactly one concern — extraction, codegen, runtime, ssr,
 * bundler or content — and contributes only within it. That is what lets them
 * merge without conflict: arrays union, flags OR together, and two facets
 * claiming the same hook is a build error rather than a silent winner.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import zintl from "zintljs/vite";
 * import { reactFacet, ssrFacet } from "zintljs/facets";
 *
 * zintl({ facets: [reactFacet(), ssrFacet()] });   // exactly these
 * zintl({ facets: ["builtins", myFacet()] });      // the defaults, plus yours
 * ```
 *
 * @example
 * ```ts
 * // A facet of your own.
 * import type { ZintlFacet } from "zintljs/facets";
 *
 * export function myFacet(): ZintlFacet {
 *   return {
 *     name: "my-extraction",
 *     concern: "extraction",
 *     extensions: [".my"],
 *     targets: [{ id: "dom:prop:innerHTML" }],
 *   };
 * }
 * ```
 */

/** The built-in preset facets. */
export * from "@zintljs/compiler/facets";

/**
 * The facet-authoring vocabulary.
 *
 * Deliberately an explicit list, not `export type *`: the compiler's own option
 * and manager types are not part of what a facet author writes against, and
 * leaking them here would put compiler internals one ctrl+click away from a
 * user entry point.
 */
export type {
  // The facet contract
  ZintlFacet,
  BaseFacet,
  FacetConcern,
  ExtractionFacet,
  CodegenFacet,
  ContentFacet,
  RuntimeFacet,
  SsrFacet,
  BundlerFacet,
  // What a facet is handed, and what it produces
  CompilerCapabilities,
  CompilerContext,
  CompilerSystemView,
  CapabilityFlags,
  SsrWrapParams,
  LocaleDetectionContext,
  MultiplexDetectionContext,
  HtmlProjectionPayload,
  // The declarative extraction vocabulary
  TargetDescriptor,
  TargetPlugin,
  SfcRule,
  SfcBlockRule,
  SuppressionRule,
  MustacheRule,
  TagMapEntry,
  CompiledExtractionState,
  ExtractionContribution,
  // Reachable from CompilerContext; nameable so facet hooks can be typed.
  IOManager,
  CatalogManager,
} from "@zintljs/compiler";

export { resolveFacets } from "./facets/resolve.js";
export {
  assembleFacets,
  assembleFacetsWithTrace,
  builtinFacets,
  excludeFacet,
  flattenFacets,
  BUILTINS,
} from "./facets/assemble.js";
export { activateFacets, formatFacetTrace } from "./facets/activate.js";
export type { ActivationResult, FacetTraceEntry } from "./facets/activate.js";
export { detectFrameworks } from "./facets/detect.js";
export type { Framework } from "./facets/detect.js";
