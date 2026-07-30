/**
 * Zero-value capabilities for compiler-internal tests.
 *
 * This is NOT a facet resolver — resolution lives in the `zintl` plugin, and
 * tests that need a real framework world live there too. This is the identity
 * element of `CompilerCapabilities`: every flag false, every collection empty.
 * Tests that exercise one narrow subsystem override just the slice they need.
 */
import { compileExtractionState } from "../../capabilities/compile-targets.js";
import type {
  CapabilityFlags,
  CompilerCapabilities,
  CompilerSystemView,
} from "../../types/capabilities.js";

const NO_FLAGS: CapabilityFlags = {
  jsx: false,
  sfc: false,
  jsxRichText: false,
  clientLocaleSync: false,
  serverRequestScope: false,
  streaming: false,
  ssr: false,
  hmr: false,
  localeRouting: false,
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
    contentFacets: [],
    virtualBoundaries: [],
    ssrEntryTargets: [],
    ssrWrapCode: undefined,
    ssrWrapExports: [],
    ssrWrapDefault: undefined,
    resolveVirtualPath: (id: string) => id,
    dynamicImportTemplate: (path: string) => `import(${JSON.stringify(path)})`,
    hmrInjectionCode: undefined,
    detectLocale: undefined,
    getProtectedCatalogKeys: async () => [],
  };
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
