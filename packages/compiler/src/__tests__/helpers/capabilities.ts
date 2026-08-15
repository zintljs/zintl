/**
 * Zero-value capabilities for compiler-internal tests.
 *
 * This is NOT a facet resolver — resolution lives in the `zintl` plugin, and
 * tests that need a real framework world live there too. This is the identity
 * element of `CompilerCapabilities`: every flag false, every collection empty.
 * Tests that exercise one narrow subsystem override just the slice they need.
 */
import { compileExtractionState } from "../../capabilities/compile-targets.js";
import { htmlFacet, reactFacet, vanillaFacet } from "../../facet/index.js";
import type {
  CapabilityFlags,
  CompiledExtractionState,
  CompilerCapabilities,
  CompilerSystemView,
  TargetDescriptor,
  ZintlFacet,
} from "../../types/capabilities.js";

const NO_FLAGS: CapabilityFlags = {
  jsx: false,
  sfc: false,
  jsxRichText: false,
  clientLocaleSync: false,
  serverRequestScope: false,
  streaming: false,
  entryReexecutionSafe: true,
  ssr: false,
  hmr: false,
  localeRouting: false,
  htmlFanOut: false,
  hotUpdate: false,
  dependencyInvalidation: false,
  sfcBlockRequestsCarryWholeFile: false,
};

function emptySystem(): CompilerSystemView {
  return {
    codegenFacets: [],
    extractionTargets: [],
    extensions: [],
    sfcRules: [],
    suppressionRules: [],
    mustacheRules: [],
    clientReactivityImports: {},
    serverComponents: false,
    contentFacets: [],
    virtualBoundaries: [],
    ssrEntryTargets: [],
    ssrWrapCode: undefined,
    ssrWrapExports: [],
    ssrWrapDefault: undefined,
    resolveVirtualPath: (id: string) => id,
    isVirtualId: (id: string) => id.includes("\0"),
    dynamicImportTemplate: (path: string) => `import(${JSON.stringify(path)})`,
    hmrInjectionCode: undefined,
    hmrSelfAcceptCode: undefined,
    detectLocale: undefined,
    getProtectedCatalogKeys: async () => [],
  };
}

/**
 * A compiled extraction state for the ordinary DOM + JSX + HTML world.
 *
 * The extractor no longer defaults to a target set, so pipeline tests that call
 * `observe()` must declare one. The descriptors are read off the real facet
 * presets rather than re-listed here, so this fixture cannot drift from
 * production. (Collecting targets is a filter, not facet resolution — that
 * still belongs exclusively to the plugin.)
 */
export function baseExtraction(): CompiledExtractionState {
  const facets = [vanillaFacet(), reactFacet(), htmlFacet()].flat(Infinity) as ZintlFacet[];
  const extractionTargets = facets
    .filter((f): f is Extract<ZintlFacet, { concern: "extraction" }> => f.concern === "extraction")
    .flatMap((f) => f.targets as TargetDescriptor[]);

  return compileExtractionState({
    extractionTargets,
    sfcRules: [],
    suppressionRules: [],
    mustacheRules: [],
  });
}

/** Zero-value capabilities, with optional overrides to the system view. */
export function emptyCapabilities(
  systemOverrides: Partial<CompilerSystemView> = {},
  flagOverrides: Partial<CapabilityFlags> = {},
): CompilerCapabilities {
  const system: CompilerSystemView = { ...emptySystem(), ...systemOverrides };
  return {
    flags: { ...NO_FLAGS, ...flagOverrides },
    system,
    facets: [],
    extraction: compileExtractionState(system),
  };
}
