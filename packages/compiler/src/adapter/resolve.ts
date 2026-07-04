import type {
  ZintlAdapter,
  ZintlPreset,
  ZintlAdapterInput,
  CodegenContribution,
  ContentContribution,
  ResolvedCapabilities,
  MergedAdapterHooks,
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
const presetRegistry = new Map<
  string,
  (options?: ZintlOptions) => (ZintlAdapter | ZintlPreset)[]
>();

/**
 * Register a named preset. Called by each preset file on load.
 * Presets expand to one or more contributions/presets.
 */
export function registerPreset(
  name: string,
  factory: (options?: ZintlOptions) => (ZintlAdapter | ZintlPreset)[],
): void {
  presetRegistry.set(name, factory);
}

/**
 * Expand a preset name, preset object, custom contribution, or nested array.
 */
function expandInput(
  input: ZintlAdapterInput,
  options?: ZintlOptions,
  seenPresets = new Set<string>(),
): ZintlAdapter[] {
  if (Array.isArray(input)) {
    const result: ZintlAdapter[] = [];
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
            type: "extraction",
            targets: [input as TargetDescriptor],
            priority: 0,
          },
        ];
      }
      const known = Array.from(presetRegistry.keys()).join(", ");
      throw new Error(
        `[Zintl] Unknown adapter preset or target descriptor "${input}". Known presets: ${known}.\n` +
          `Pass a ZintlAdapter object for custom adapters.`,
      );
    }
    seenPresets.add(input);
    return expandInput(factory(options), options, seenPresets);
  }

  if (input && typeof input === "object") {
    if ("type" in input && input.type === "preset") {
      const presetName = input.name;
      if (presetName && seenPresets.has(presetName)) {
        return [];
      }
      if (presetName) seenPresets.add(presetName);
      return expandInput(input.use, options, seenPresets);
    }

    return [input as ZintlAdapter];
  }

  throw new Error(`[Zintl] Invalid adapter input: ${JSON.stringify(input)}`);
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
  existingAdapterName: string,
  candidateAdapterName: string,
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
    `[Zintl] Adapter conflict: both "${existingAdapterName}" and "${candidateAdapterName}" provide "${hookName}" at the same priority (${existingPriority}). ` +
      `Only one adapter may contribute this hook. Increase priority on one, or remove the other.`,
  );
}

/**
 * Merge codegen contributions with file extension conflict detection.
 */
function mergeCodegenAdapters(
  existing: CodegenContribution[],
  candidate: CodegenContribution | undefined,
  candidateName: string,
): CodegenContribution[] {
  if (!candidate) return existing;

  for (const existing_codegen of existing) {
    for (const ext of candidate.extensions) {
      if (existing_codegen.extensions.includes(ext)) {
        const existingPriority = existing_codegen.priority ?? 0;
        const candidatePriority = candidate.priority ?? 0;
        if (existingPriority === candidatePriority) {
          throw new Error(
            `[Zintl] Adapter conflict: codegen contributions from "${existing_codegen.name}" and "${candidateName}" ` +
              `both claim extension "${ext}" at the same priority (${existingPriority}). ` +
              `Only one codegen contribution may handle a given extension at the same priority.`,
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
  codegenAdapters: CodegenContribution[];
  extractionTargets: TargetDescriptor[];
  extensions: string[];
  sfcRules: SfcRule[];
  suppressionRules: SuppressionRule[];
  mustacheRules: MustacheRule[];
  contentAdapters: ContentContribution[];

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
    codegenAdapters: [],
    extractionTargets: [],
    extensions: [],
    sfcRules: [],
    suppressionRules: [],
    mustacheRules: [],
    contentAdapters: [],
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

function mergeAdapter(state: MergeState, adapter: ZintlAdapter): void {
  const name = adapter.name;
  const priority = adapter.priority ?? 0;

  switch (adapter.type) {
    case "extraction": {
      for (const t of adapter.targets) {
        if (!state.extractionTargets.includes(t)) {
          state.extractionTargets.push(t);
        }
      }
      for (const e of adapter.extensions ?? []) {
        if (!state.extensions.includes(e)) {
          state.extensions.push(e);
        }
      }
      if (adapter.sfcRules) {
        state.sfcRules.push(...adapter.sfcRules);
      }
      if (adapter.suppressionRules) {
        state.suppressionRules.push(...adapter.suppressionRules);
      }
      if (adapter.mustacheRegex) {
        state.mustacheRules.push({
          extensions: adapter.extensions || [],
          pattern: adapter.mustacheRegex,
        });
      }
      break;
    }
    case "content": {
      state.contentAdapters.push(adapter);
      if (adapter.getProtectedCatalogKeys) {
        state.getProtectedCatalogKeysChain.push(adapter.getProtectedCatalogKeys);
      }
      break;
    }
    case "codegen": {
      state.codegenAdapters = mergeCodegenAdapters(state.codegenAdapters, adapter, name);
      for (const e of adapter.extensions) {
        if (!state.extensions.includes(e)) {
          state.extensions.push(e);
        }
      }
      break;
    }
    case "ssr": {
      if (adapter.entryTargets) {
        state.ssrEntryTargets.push(...adapter.entryTargets);
      }
      if (adapter.wrapCode !== undefined) {
        state.ssrWrapCode = mergeHook(
          state.ssrWrapCode,
          state.ssrWrapCodePriority,
          adapter.wrapCode,
          priority,
          "ssr.wrapCode",
          state.ssrWrapCodeProvider,
          name,
        );
        if (state.ssrWrapCode === adapter.wrapCode) {
          state.ssrWrapCodeProvider = name;
          state.ssrWrapCodePriority = priority;
        }
      }
      if (adapter.wrapExports) {
        state.ssrWrapExports.push(...adapter.wrapExports);
      }
      if (adapter.wrapDefault !== undefined && state.ssrWrapDefault === undefined) {
        state.ssrWrapDefault = adapter.wrapDefault;
      }
      break;
    }
    case "runtime": {
      if (adapter.clientLocaleSync) state.clientLocaleSync = true;
      if (adapter.serverRequestScope) state.serverRequestScope = true;
      if (adapter.streamInjection) state.streamInjection = true;
      if (adapter.detectLocale) state.detectLocaleChain.push(adapter.detectLocale);
      break;
    }
    case "bundler": {
      if (adapter.resolveVirtualPath !== undefined) {
        state.resolveVirtualPath = mergeHook(
          state.resolveVirtualPath,
          state.resolveVirtualPathPriority,
          adapter.resolveVirtualPath,
          priority,
          "bundler.resolveVirtualPath",
          state.resolveVirtualPathProvider,
          name,
        );
        if (state.resolveVirtualPath === adapter.resolveVirtualPath) {
          state.resolveVirtualPathProvider = name;
          state.resolveVirtualPathPriority = priority;
        }
      }
      if (adapter.dynamicImportTemplate !== undefined) {
        state.dynamicImportTemplate = mergeHook(
          state.dynamicImportTemplate,
          state.dynamicImportTemplatePriority,
          adapter.dynamicImportTemplate,
          priority,
          "bundler.dynamicImportTemplate",
          state.dynamicImportTemplateProvider,
          name,
        );
        if (state.dynamicImportTemplate === adapter.dynamicImportTemplate) {
          state.dynamicImportTemplateProvider = name;
          state.dynamicImportTemplatePriority = priority;
        }
      }
      if (adapter.hmrInjectionCode !== undefined) {
        state.hmrInjectionCode = mergeHook(
          state.hmrInjectionCode,
          state.hmrInjectionCodePriority,
          adapter.hmrInjectionCode,
          priority,
          "bundler.hmrInjectionCode",
          state.hmrInjectionCodeProvider,
          name,
        );
        if (state.hmrInjectionCode === adapter.hmrInjectionCode) {
          state.hmrInjectionCodeProvider = name;
          state.hmrInjectionCodePriority = priority;
        }
      }
      if (adapter.isMultiplex !== undefined) {
        state.isMultiplex = mergeHook(
          state.isMultiplex,
          state.isMultiplexPriority,
          adapter.isMultiplex,
          priority,
          "bundler.isMultiplex",
          state.isMultiplexProvider,
          name,
        );
        if (state.isMultiplex === adapter.isMultiplex) {
          state.isMultiplexProvider = name;
          state.isMultiplexPriority = priority;
        }
      }
      if (adapter.fanBuildInputs !== undefined) {
        state.fanBuildInputs = mergeHook(
          state.fanBuildInputs,
          state.fanBuildInputsPriority,
          adapter.fanBuildInputs,
          priority,
          "bundler.fanBuildInputs",
          state.fanBuildInputsProvider,
          name,
        );
        if (state.fanBuildInputs === adapter.fanBuildInputs) {
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
    jsx: state.codegenAdapters.some(
      (a) => a.wrapJsxRichText !== undefined || a.serializeTags !== undefined,
    ),
    sfc: state.codegenAdapters.some((a) => a.wrapSfcScript !== undefined),
    jsxRichText: state.codegenAdapters.some((a) => a.wrapJsxRichText !== undefined),

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

function stateToHooks(state: MergeState): MergedAdapterHooks {
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
  for (const adapter of state.contentAdapters) {
    if (adapter.virtualBoundaries) {
      virtualBoundaries.push(...adapter.virtualBoundaries);
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
    codegenAdapters: state.codegenAdapters,
    extractionTargets: state.extractionTargets,
    extensions: state.extensions,
    sfcRules: state.sfcRules,
    suppressionRules: state.suppressionRules,
    mustacheRules: state.mustacheRules,
    contentAdapters: state.contentAdapters,
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

export interface ResolvedCompilerState {
  /** Pre-resolved capability flags — subsystems query this, never raw adapters */
  capabilities: ResolvedCapabilities;
  /** Merged, ready-to-call hooks — subsystems call these, never raw adapters */
  hooks: MergedAdapterHooks;
  /** The flat list of adapters after preset expansion (for debugging/introspection) */
  adapters: ZintlAdapter[];
  /** Pre-resolved extraction configuration */
  extraction: CompiledExtractionState;
}

export type ResolvedAdapters = ResolvedCompilerState;

/**
 * Resolve a list of adapter inputs (preset names or adapter objects) into
 * the pre-merged capabilities and hooks.
 */
export function resolveAdapters(
  inputs: ZintlAdapterInput[] = [],
  options?: ZintlOptions,
): ResolvedCompilerState {
  const flatAdapters: ZintlAdapter[] = [];

  // Expose configuration and auto-inject baseline content adapters if not explicitly provided
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
    flatAdapters.push(...expandInput(input, options));
  }

  // 1. Sort descending by priority (default: 0)
  const sorted = [...flatAdapters].sort((a, b) => {
    const pA = a.priority ?? 0;
    const pB = b.priority ?? 0;
    return pB - pA;
  });

  // 2. Deduplicate adapters by name (keeping the one with the highest priority first)
  const uniqueAdapters: ZintlAdapter[] = [];
  const seen = new Set<string>();
  for (const a of sorted) {
    if (!seen.has(a.name)) {
      seen.add(a.name);
      uniqueAdapters.push(a);
    }
  }

  const state = createEmptyState();
  for (const adapter of uniqueAdapters) {
    mergeAdapter(state, adapter);
  }

  const capabilities = stateToCapabilities(state);
  const hooks = stateToHooks(state);

  const targetDescriptors = [...hooks.extractionTargets];
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

  // Framework rules flow downward from compiler adapters directly to the extraction state
  extraction.sfcRules = hooks.sfcRules;
  extraction.suppressionRules = hooks.suppressionRules;
  extraction.mustacheRules = hooks.mustacheRules;

  return {
    capabilities,
    hooks,
    adapters: uniqueAdapters,
    extraction,
  };
}
