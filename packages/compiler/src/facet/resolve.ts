import type {
  ZintlFacet,
  ZintlFacetInput,
  CodegenFacet,
  ContentFacet,
  ResolvedCapabilities,
  ResolvedFacetSystem,
  SsrWrapParams,
  LocaleDetectionContext,
  MultiplexDetectionContext,
} from "./types.js";
import {
  resolveTargets,
  type CompiledExtractionState,
  type TargetDescriptor,
  type SfcRule,
  type SuppressionRule,
  type MustacheRule,
} from "@zintl/extractor";

import type { ZintlOptions } from "../types/compiler.js";

// Preset registry — populated by presets/index.ts to avoid circular imports
const presetRegistry = new Map<string, (options?: ZintlOptions) => ZintlFacetInput[]>();

/**
 * Register a named preset. Called by each preset file on load.
 * Presets expand to one or more contributions/presets.
 */
export function registerPreset(
  name: string,
  factory: (options?: ZintlOptions) => ZintlFacetInput[],
): void {
  presetRegistry.set(name, factory);
}

/**
 * Expand a preset name, preset object, custom contribution, or nested array.
 */
function expandInput(
  input: ZintlFacetInput,
  options?: ZintlOptions,
  seenPresets = new Set<string>(),
): ZintlFacet[] {
  if (Array.isArray(input)) {
    const result: ZintlFacet[] = [];
    for (const item of input) {
      result.push(...expandInput(item, options, seenPresets));
    }
    return result;
  }

  if (typeof input === "string") {
    if (seenPresets.has(input)) {
      return []; // prevent circular references
    }
    const factory = presetRegistry.get(input);
    if (!factory) {
      if (input.includes(":")) {
        return [
          {
            name: `custom-target-${input}`,
            concern: "extraction",
            targets: [input as TargetDescriptor],
            priority: 0,
          },
        ];
      }
      const known = Array.from(presetRegistry.keys()).join(", ");
      throw new Error(
        `[Zintl] Unknown facet preset or target descriptor "${input}". Known presets: ${known}.\n` +
          `Pass a ZintlFacet object for custom facets.`,
      );
    }
    seenPresets.add(input);
    return expandInput(factory(options), options, seenPresets);
  }

  if (input && typeof input === "object") {
    return [input as ZintlFacet];
  }

  throw new Error(`[Zintl] Invalid facet input: ${JSON.stringify(input)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * First-contributor-wins for function hooks, with conflict detection and priority overrides.
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

  // Bundler (first-contributor-wins)
  resolveVirtualPath: ((id: string) => string) | undefined;
  resolveVirtualPathProvider: string;
  resolveVirtualPathPriority: number;
  dynamicImportTemplate: ((path: string, isDev: boolean) => string) | undefined;
  dynamicImportTemplateProvider: string;
  dynamicImportTemplatePriority: number;
  hmrInjectionCode: ((fileId: string, hmrToken: number) => string) | undefined;
  hmrInjectionCodeProvider: string;
  hmrInjectionCodePriority: number;
  isMultiplex: ((context: MultiplexDetectionContext) => boolean | undefined) | undefined;
  isMultiplexProvider: string;
  isMultiplexPriority: number;
  fanBuildInputs:
    | ((inputs: Record<string, string>, locales: string[], root: string) => Record<string, string>)
    | undefined;
  fanBuildInputsProvider: string;
  fanBuildInputsPriority: number;
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
    isMultiplex: undefined,
    isMultiplexProvider: "",
    isMultiplexPriority: -1,
    fanBuildInputs: undefined,
    fanBuildInputsProvider: "",
    fanBuildInputsPriority: -1,
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
      if (facet.isMultiplex !== undefined) {
        state.isMultiplex = mergeHook(
          state.isMultiplex,
          state.isMultiplexPriority,
          facet.isMultiplex,
          priority,
          "bundler.isMultiplex",
          state.isMultiplexProvider,
          name,
        );
        if (state.isMultiplex === facet.isMultiplex) {
          state.isMultiplexProvider = name;
          state.isMultiplexPriority = priority;
        }
      }
      if (facet.fanBuildInputs !== undefined) {
        state.fanBuildInputs = mergeHook(
          state.fanBuildInputs,
          state.fanBuildInputsPriority,
          facet.fanBuildInputs,
          priority,
          "bundler.fanBuildInputs",
          state.fanBuildInputsProvider,
          name,
        );
        if (state.fanBuildInputs === facet.fanBuildInputs) {
          state.fanBuildInputsProvider = name;
          state.fanBuildInputsPriority = priority;
        }
      }
      break;
    }
  }
}

function stateToCapabilities(state: MergeState): ResolvedCapabilities {
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

function stateToHooks(state: MergeState): ResolvedFacetSystem {
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
    contentFacets: state.contentFacets,
    virtualBoundaries,

    ssrEntryTargets: state.ssrEntryTargets,
    ssrWrapCode: state.ssrWrapCode,
    ssrWrapExports: state.ssrWrapExports,
    ssrWrapDefault: state.ssrWrapDefault,

    resolveVirtualPath: state.resolveVirtualPath ?? DEFAULT_RESOLVE_VIRTUAL_PATH,
    dynamicImportTemplate: state.dynamicImportTemplate ?? DEFAULT_DYNAMIC_IMPORT_TEMPLATE,
    hmrInjectionCode: state.hmrInjectionCode,
    isMultiplex: state.isMultiplex,
    fanBuildInputs: state.fanBuildInputs,

    detectLocale,
    getProtectedCatalogKeys,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedFacets {
  /** Pre-resolved capability flags — subsystems query this, never raw facets */
  capabilities: ResolvedCapabilities;
  /** Merged, ready-to-call system view — subsystems call this, never raw facets */
  system: ResolvedFacetSystem;
  /** The flat list of facets after preset expansion (for debugging/introspection) */
  facets: ZintlFacet[];
  /** Pre-resolved extraction configuration */
  extraction: CompiledExtractionState;
}

/**
 * Resolve a list of facet inputs (preset names or facet objects) into
 * the pre-merged capabilities and system view.
 */
export function resolveFacets(
  inputs: ZintlFacetInput[] = [],
  options?: ZintlOptions,
): ResolvedFacets {
  const flatFacets: ZintlFacet[] = [];

  // Expose configuration and auto-inject baseline content facets if not explicitly provided
  const baseInputs = [...inputs];
  const hasAssetsPreset = inputs.some(
    (i) =>
      i === "assets" ||
      (i &&
        typeof i === "object" &&
        !Array.isArray(i) &&
        "name" in i &&
        i.name === "system-static-assets"),
  );
  if (!hasAssetsPreset) {
    baseInputs.push("assets");
  }
  const hasHtmlPreset = inputs.some(
    (i) =>
      i === "html" ||
      (i &&
        typeof i === "object" &&
        !Array.isArray(i) &&
        "name" in i &&
        (i.name === "html-extraction" || i.name === "system-html-projection")),
  );
  if (!hasHtmlPreset) {
    baseInputs.push("html");
  }

  for (const input of baseInputs) {
    flatFacets.push(...expandInput(input, options));
  }

  // 1. Sort descending by priority (default: 0)
  const sorted = [...flatFacets].sort((a, b) => {
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

  const capabilities = stateToCapabilities(state);
  const system = stateToHooks(state);

  const targetDescriptors = [...system.extractionTargets];
  // Add target descriptors from inputs that are string extraction targets
  for (const input of inputs) {
    if (typeof input === "string" && input.includes(":")) {
      if (!targetDescriptors.includes(input as any)) {
        targetDescriptors.push(input as any);
      }
    }
  }

  // Resolve target descriptors through extractor's resolveTargets
  const extraction = resolveTargets(targetDescriptors);

  // Framework rules flow downward from compiler facets directly to the extraction state
  extraction.sfcRules = system.sfcRules;
  extraction.suppressionRules = system.suppressionRules;
  extraction.mustacheRules = system.mustacheRules;

  return {
    capabilities,
    system,
    facets: uniqueFacets,
    extraction,
  };
}
