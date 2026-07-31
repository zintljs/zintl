/**
 * Facet resolution — the orchestration layer.
 *
 * This is deliberately part of the *plugin*, not the compiler. Resolution is the
 * act of deciding what the compiler will be, and that decision belongs to the
 * layer that knows about the host toolchain:
 *
 *   extractor  ←  compiler (core)  ←  compiler/facets  ←  zintl (plugin)
 *
 * The compiler receives the output of this function and executes it. It never
 * calls in here, and it has no idea that React, Vue, Svelte, Next, SSR or Vite
 * exist.
 *
 * Merge semantics:
 * - Arrays (targets, extensions, rules, ssr entry targets/exports) union.
 * - Runtime booleans OR together.
 * - Function hooks resolve by highest priority, and a tie is a hard error.
 * - Codegen facets stay a list, matched per-file; two facets claiming the same
 *   extension at the same priority is a hard error.
 */
import { compileExtractionState } from "@zintljs/compiler";
import type {
  CapabilityFlags,
  CodegenFacet,
  CompilerCapabilities,
  CompilerSystemView,
  ContentFacet,
  LocaleDetectionContext,
  MustacheRule,
  SfcRule,
  SsrWrapParams,
  SuppressionRule,
  TargetDescriptor,
  ZintlFacet,
} from "@zintljs/compiler";

// ─────────────────────────────────────────────────────────────────────────────
// Merge Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Highest-priority-wins for function hooks, with conflict detection on ties.
 */
function mergeHook<T extends (...args: any[]) => any>(
  existing: T | undefined,
  existingPriority: number,
  candidate: T | undefined,
  candidatePriority: number,
  hookName: string,
  existingFacetName: string,
  candidateFacetName: string,
): T | undefined {
  if (candidate === undefined) return existing;
  if (existing === undefined) return candidate;

  if (candidatePriority > existingPriority) {
    return candidate;
  }
  if (existingPriority > candidatePriority) {
    return existing;
  }

  throw new Error(
    `[Zintl] Facet conflict: both "${existingFacetName}" and "${candidateFacetName}" provide "${hookName}" at the same priority (${existingPriority}). ` +
      `Only one facet may contribute this hook. Increase priority on one, or remove the other.`,
  );
}

/**
 * Merge codegen facets with file extension conflict detection.
 */
function mergeCodegenFacets(
  existing: CodegenFacet[],
  candidate: CodegenFacet | undefined,
  candidateName: string,
): CodegenFacet[] {
  if (!candidate) return existing;

  for (const existing_codegen of existing) {
    for (const ext of candidate.extensions) {
      if (existing_codegen.extensions.includes(ext)) {
        const existingPriority = existing_codegen.priority ?? 0;
        const candidatePriority = candidate.priority ?? 0;
        if (existingPriority === candidatePriority) {
          throw new Error(
            `[Zintl] Facet conflict: codegen facets from "${existing_codegen.name}" and "${candidateName}" ` +
              `both claim extension "${ext}" at the same priority (${existingPriority}). ` +
              `Only one codegen facet may handle a given extension at the same priority.`,
          );
        }
      }
    }
  }

  return [...existing, candidate];
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Resolution
// ─────────────────────────────────────────────────────────────────────────────

interface MergeState {
  codegenFacets: CodegenFacet[];
  extractionTargets: TargetDescriptor[];
  extensions: string[];
  sfcRules: SfcRule[];
  suppressionRules: SuppressionRule[];
  mustacheRules: MustacheRule[];
  clientReactivityImports: Record<string, string[]>;
  contentFacets: ContentFacet[];

  // SSR
  ssrEntryTargets: (string | RegExp | ((id: string) => boolean))[];
  ssrWrapCode: ((params: SsrWrapParams) => string | undefined) | undefined;
  ssrWrapCodeProvider: string;
  ssrWrapCodePriority: number;
  ssrWrapExports: string[];
  ssrWrapDefault: boolean | "fetch" | undefined;

  // Runtime (OR-merged booleans, chained detectLocale)
  clientLocaleSync: boolean;
  serverRequestScope: boolean;
  streamInjection: boolean;
  detectLocaleChain: ((context: LocaleDetectionContext) => string | undefined)[];

  // Bundler (highest-priority-wins)
  resolveVirtualPath: ((id: string) => string) | undefined;
  resolveVirtualPathProvider: string;
  resolveVirtualPathPriority: number;
  dynamicImportTemplate: ((path: string, isDev: boolean) => string) | undefined;
  dynamicImportTemplateProvider: string;
  dynamicImportTemplatePriority: number;
  hmrInjectionCode:
    | ((fileId: string, hmrToken: number, hasAnchors?: boolean) => string)
    | undefined;
  hmrInjectionCodeProvider: string;
  hmrInjectionCodePriority: number;

  getProtectedCatalogKeysChain: ((
    boundaryId: string,
    context: any,
  ) => Promise<string[]> | string[])[];
}

function createEmptyState(): MergeState {
  return {
    codegenFacets: [],
    extractionTargets: [],
    extensions: [],
    sfcRules: [],
    suppressionRules: [],
    mustacheRules: [],
    clientReactivityImports: {},
    contentFacets: [],
    ssrEntryTargets: [],
    ssrWrapCode: undefined,
    ssrWrapCodeProvider: "",
    ssrWrapCodePriority: -1,
    ssrWrapExports: [],
    ssrWrapDefault: undefined,
    clientLocaleSync: false,
    serverRequestScope: false,
    streamInjection: false,
    detectLocaleChain: [],
    resolveVirtualPath: undefined,
    resolveVirtualPathProvider: "",
    resolveVirtualPathPriority: -1,
    dynamicImportTemplate: undefined,
    dynamicImportTemplateProvider: "",
    dynamicImportTemplatePriority: -1,
    hmrInjectionCode: undefined,
    hmrInjectionCodeProvider: "",
    hmrInjectionCodePriority: -1,
    getProtectedCatalogKeysChain: [],
  };
}

function mergeFacet(state: MergeState, facet: ZintlFacet): void {
  const name = facet.name;
  const priority = facet.priority ?? 0;

  switch (facet.concern) {
    case "extraction": {
      for (const t of facet.targets) {
        if (!state.extractionTargets.includes(t)) {
          state.extractionTargets.push(t);
        }
      }
      for (const e of facet.extensions ?? []) {
        if (!state.extensions.includes(e)) {
          state.extensions.push(e);
        }
      }
      if (facet.sfcRules) {
        state.sfcRules.push(...facet.sfcRules);
      }
      if (facet.suppressionRules) {
        state.suppressionRules.push(...facet.suppressionRules);
      }
      if (facet.mustacheRegex) {
        state.mustacheRules.push({
          extensions: facet.extensions || [],
          pattern: facet.mustacheRegex,
        });
      }
      break;
    }
    case "content": {
      state.contentFacets.push(facet);
      if (facet.getProtectedCatalogKeys) {
        state.getProtectedCatalogKeysChain.push(facet.getProtectedCatalogKeys);
      }
      break;
    }
    case "codegen": {
      state.codegenFacets = mergeCodegenFacets(state.codegenFacets, facet, name);
      for (const [source, specifiers] of Object.entries(facet.clientReactivityImports ?? {})) {
        const existing = (state.clientReactivityImports[source] ??= []);
        for (const spec of specifiers) {
          if (!existing.includes(spec)) existing.push(spec);
        }
      }
      for (const e of facet.extensions) {
        if (!state.extensions.includes(e)) {
          state.extensions.push(e);
        }
      }
      break;
    }
    case "ssr": {
      if (facet.entryTargets) {
        state.ssrEntryTargets.push(...facet.entryTargets);
      }
      if (facet.wrapCode !== undefined) {
        state.ssrWrapCode = mergeHook(
          state.ssrWrapCode,
          state.ssrWrapCodePriority,
          facet.wrapCode,
          priority,
          "ssr.wrapCode",
          state.ssrWrapCodeProvider,
          name,
        );
        if (state.ssrWrapCode === facet.wrapCode) {
          state.ssrWrapCodeProvider = name;
          state.ssrWrapCodePriority = priority;
        }
      }
      if (facet.wrapExports) {
        state.ssrWrapExports.push(...facet.wrapExports);
      }
      if (facet.wrapDefault !== undefined && state.ssrWrapDefault === undefined) {
        state.ssrWrapDefault = facet.wrapDefault;
      }
      break;
    }
    case "runtime": {
      if (facet.clientLocaleSync) state.clientLocaleSync = true;
      if (facet.serverRequestScope) state.serverRequestScope = true;
      if (facet.streamInjection) state.streamInjection = true;
      if (facet.detectLocale) state.detectLocaleChain.push(facet.detectLocale);
      break;
    }
    case "bundler": {
      if (facet.resolveVirtualPath !== undefined) {
        state.resolveVirtualPath = mergeHook(
          state.resolveVirtualPath,
          state.resolveVirtualPathPriority,
          facet.resolveVirtualPath,
          priority,
          "bundler.resolveVirtualPath",
          state.resolveVirtualPathProvider,
          name,
        );
        if (state.resolveVirtualPath === facet.resolveVirtualPath) {
          state.resolveVirtualPathProvider = name;
          state.resolveVirtualPathPriority = priority;
        }
      }
      if (facet.dynamicImportTemplate !== undefined) {
        state.dynamicImportTemplate = mergeHook(
          state.dynamicImportTemplate,
          state.dynamicImportTemplatePriority,
          facet.dynamicImportTemplate,
          priority,
          "bundler.dynamicImportTemplate",
          state.dynamicImportTemplateProvider,
          name,
        );
        if (state.dynamicImportTemplate === facet.dynamicImportTemplate) {
          state.dynamicImportTemplateProvider = name;
          state.dynamicImportTemplatePriority = priority;
        }
      }
      if (facet.hmrInjectionCode !== undefined) {
        state.hmrInjectionCode = mergeHook(
          state.hmrInjectionCode,
          state.hmrInjectionCodePriority,
          facet.hmrInjectionCode,
          priority,
          "bundler.hmrInjectionCode",
          state.hmrInjectionCodeProvider,
          name,
        );
        if (state.hmrInjectionCode === facet.hmrInjectionCode) {
          state.hmrInjectionCodeProvider = name;
          state.hmrInjectionCodePriority = priority;
        }
      }
      break;
    }
  }
}

function stateToCapabilities(state: MergeState): CapabilityFlags {
  return {
    // Codegen
    jsx: state.codegenFacets.some(
      (a) => a.wrapJsxRichText !== undefined || a.serializeTags !== undefined,
    ),
    sfc: state.codegenFacets.some((a) => a.wrapSfcScript !== undefined),
    jsxRichText: state.codegenFacets.some((a) => a.wrapJsxRichText !== undefined),

    // Runtime
    clientLocaleSync: state.clientLocaleSync,
    serverRequestScope: state.serverRequestScope,
    streaming: state.streamInjection,

    // SSR
    ssr:
      state.ssrEntryTargets.length > 0 ||
      state.ssrWrapCode !== undefined ||
      state.serverRequestScope ||
      state.streamInjection,

    // Bundler
    hmr: state.hmrInjectionCode !== undefined,
    localeRouting: state.clientLocaleSync || state.serverRequestScope,
  };
}

// Default fallbacks for bundler hooks (always required)
const DEFAULT_RESOLVE_VIRTUAL_PATH = (id: string): string => id;
const DEFAULT_DYNAMIC_IMPORT_TEMPLATE = (path: string, _isDev: boolean): string =>
  `import(${JSON.stringify(path)})`;

function stateToHooks(state: MergeState): CompilerSystemView {
  // Build chained detectLocale
  const chain = state.detectLocaleChain;
  const detectLocale =
    chain.length === 0
      ? undefined
      : (context: LocaleDetectionContext): string | undefined => {
          for (const fn of chain) {
            const result = fn(context);
            if (result !== undefined) return result;
          }
          return undefined;
        };

  const virtualBoundaries: string[] = [];
  for (const facet of state.contentFacets) {
    if (facet.virtualBoundaries) {
      virtualBoundaries.push(...facet.virtualBoundaries);
    }
  }

  const getProtectedCatalogKeysChain = state.getProtectedCatalogKeysChain;
  const getProtectedCatalogKeys = async (boundaryId: string, context: any): Promise<string[]> => {
    const allKeys = new Set<string>();
    for (const fn of getProtectedCatalogKeysChain) {
      const keys = await fn(boundaryId, context);
      if (keys) {
        for (const k of keys) allKeys.add(k);
      }
    }
    return Array.from(allKeys);
  };

  return {
    codegenFacets: state.codegenFacets,
    extractionTargets: state.extractionTargets,
    extensions: state.extensions,
    sfcRules: state.sfcRules,
    suppressionRules: state.suppressionRules,
    mustacheRules: state.mustacheRules,
    clientReactivityImports: state.clientReactivityImports,
    contentFacets: state.contentFacets,
    virtualBoundaries,

    ssrEntryTargets: state.ssrEntryTargets,
    ssrWrapCode: state.ssrWrapCode,
    ssrWrapExports: state.ssrWrapExports,
    ssrWrapDefault: state.ssrWrapDefault,

    resolveVirtualPath: state.resolveVirtualPath ?? DEFAULT_RESOLVE_VIRTUAL_PATH,
    dynamicImportTemplate: state.dynamicImportTemplate ?? DEFAULT_DYNAMIC_IMPORT_TEMPLATE,
    hmrInjectionCode: state.hmrInjectionCode,

    detectLocale,
    getProtectedCatalogKeys,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a flat list of facet objects into the capabilities handed to the compiler.
 */
export function resolveFacets(facets: ZintlFacet[] = []): CompilerCapabilities {
  const baseFacets = [...facets];

  // 1. Sort descending by priority (default: 0)
  const sorted = [...baseFacets].sort((a, b) => {
    const pA = a.priority ?? 0;
    const pB = b.priority ?? 0;
    return pB - pA;
  });

  // 2. Deduplicate facets by name (keeping the one with the highest priority first)
  const uniqueFacets: ZintlFacet[] = [];
  const seen = new Set<string>();
  for (const a of sorted) {
    if (!seen.has(a.name)) {
      seen.add(a.name);
      uniqueFacets.push(a);
    }
  }

  const state = createEmptyState();
  for (const facet of uniqueFacets) {
    mergeFacet(state, facet);
  }

  const flags = stateToCapabilities(state);
  const system = stateToHooks(state);

  // Declarative extraction rules are compiled by the compiler — the plugin must
  // never depend on @zintljs/extractor.
  const extraction = compileExtractionState(system);

  return {
    flags,
    system,
    facets: uniqueFacets,
    extraction,
  };
}
