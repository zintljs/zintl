import type {
  ZintlAdapter,
  CodegenAdapter,
  ExtractionAdapter,
  SsrAdapter,
  RuntimeAdapter,
  BundlerAdapter,
  ResolvedCapabilities,
  MergedAdapterHooks,
  SsrWrapParams,
  LocaleDetectionContext,
  MultiplexDetectionContext,
  TagMapEntry,
} from "./types.js";
import type { TargetDescriptor } from "@zintl/extractor";

// Preset registry — populated by presets/index.ts to avoid circular imports
const presetRegistry = new Map<string, () => ZintlAdapter[]>();

/**
 * Register a named preset. Called by each preset file on load.
 * Presets expand to one or more adapters (e.g. "react" → [reactExtraction, reactCodegen]).
 */
export function registerPreset(name: string, factory: () => ZintlAdapter[]): void {
  presetRegistry.set(name, factory);
}

/**
 * Expand a preset name or pass-through a ZintlAdapter object.
 * Throws a helpful error for unknown preset names.
 */
function expandInput(input: string | ZintlAdapter): ZintlAdapter[] {
  if (typeof input === "string") {
    const factory = presetRegistry.get(input);
    if (!factory) {
      const known = Array.from(presetRegistry.keys()).join(", ");
      throw new Error(
        `[Zintl] Unknown adapter preset "${input}". Known presets: ${known}.\n` +
          `Pass a ZintlAdapter object for custom adapters.`,
      );
    }
    return factory();
  }
  return [input];
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * First-contributor-wins for function hooks, with conflict detection.
 * Two adapters providing the same function hook is an error — not silent ordering dependence.
 */
function mergeHook<T extends (...args: any[]) => any>(
  existing: T | undefined,
  candidate: T | undefined,
  hookName: string,
  existingAdapterName: string,
  candidateAdapterName: string,
): T | undefined {
  if (candidate === undefined) return existing;
  if (existing !== undefined) {
    throw new Error(
      `[Zintl] Adapter conflict: both "${existingAdapterName}" and "${candidateAdapterName}" provide "${hookName}". ` +
        `Only one adapter may contribute this hook. Remove one, or use a custom adapter to combine them.`,
    );
  }
  return candidate;
}

/**
 * Merge codegen adapters with file extension conflict detection.
 * Two adapters claiming the same extension is an error.
 */
function mergeCodegenAdapters(
  existing: CodegenAdapter[],
  candidate: CodegenAdapter | undefined,
  candidateName: string,
): CodegenAdapter[] {
  if (!candidate) return existing;

  for (const existing_codegen of existing) {
    for (const ext of candidate.extensions) {
      if (existing_codegen.extensions.includes(ext)) {
        throw new Error(
          `[Zintl] Adapter conflict: codegen adapters from "${existing_codegen.extensions.join(",")}" and "${candidateName}" ` +
            `both claim extension "${ext}". Only one codegen adapter may handle a given extension. ` +
            `Use a "priority" field or remove one adapter.`,
        );
      }
    }
  }

  return [...existing, candidate];
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Resolution
// ─────────────────────────────────────────────────────────────────────────────

interface MergeState {
  codegenAdapters: CodegenAdapter[];
  extractionTargets: TargetDescriptor[];
  extensions: string[];

  // SSR
  ssrEntryTargets: (string | RegExp | ((id: string) => boolean))[];
  ssrWrapCode: ((params: SsrWrapParams) => string | undefined) | undefined;
  ssrWrapCodeProvider: string;
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
  dynamicImportTemplate: ((path: string, isDev: boolean) => string) | undefined;
  dynamicImportTemplateProvider: string;
  hmrInjectionCode: ((fileId: string, hmrToken: number) => string) | undefined;
  hmrInjectionCodeProvider: string;
  isMultiplex: ((context: MultiplexDetectionContext) => boolean | undefined) | undefined;
  isMultiplexProvider: string;
  fanBuildInputs:
    | ((inputs: Record<string, string>, locales: string[], root: string) => Record<string, string>)
    | undefined;
  fanBuildInputsProvider: string;
}

function createEmptyState(): MergeState {
  return {
    codegenAdapters: [],
    extractionTargets: [],
    extensions: [],
    ssrEntryTargets: [],
    ssrWrapCode: undefined,
    ssrWrapCodeProvider: "",
    ssrWrapExports: [],
    ssrWrapDefault: undefined,
    clientLocaleSync: false,
    serverRequestScope: false,
    streamInjection: false,
    detectLocaleChain: [],
    resolveVirtualPath: undefined,
    resolveVirtualPathProvider: "",
    dynamicImportTemplate: undefined,
    dynamicImportTemplateProvider: "",
    hmrInjectionCode: undefined,
    hmrInjectionCodeProvider: "",
    isMultiplex: undefined,
    isMultiplexProvider: "",
    fanBuildInputs: undefined,
    fanBuildInputsProvider: "",
  };
}

function mergeAdapter(state: MergeState, adapter: ZintlAdapter): void {
  const name = adapter.name;

  // ── Extraction (union) ──
  if (adapter.extraction) {
    const ext: ExtractionAdapter = adapter.extraction;
    for (const t of ext.targets) {
      if (!state.extractionTargets.includes(t)) {
        state.extractionTargets.push(t);
      }
    }
    for (const e of ext.extensions ?? []) {
      if (!state.extensions.includes(e)) {
        state.extensions.push(e);
      }
    }
  }

  // ── Codegen (per-file, conflict detection) ──
  if (adapter.codegen) {
    state.codegenAdapters = mergeCodegenAdapters(state.codegenAdapters, adapter.codegen, name);
    for (const e of adapter.codegen.extensions) {
      if (!state.extensions.includes(e)) {
        state.extensions.push(e);
      }
    }
  }

  // ── SSR (union arrays, first-contributor-wins for wrapCode) ──
  if (adapter.ssr) {
    const ssr: SsrAdapter = adapter.ssr;
    if (ssr.entryTargets) {
      state.ssrEntryTargets.push(...ssr.entryTargets);
    }
    if (ssr.wrapCode !== undefined) {
      state.ssrWrapCode = mergeHook(
        state.ssrWrapCode,
        ssr.wrapCode,
        "ssr.wrapCode",
        state.ssrWrapCodeProvider,
        name,
      );
      if (!state.ssrWrapCodeProvider) state.ssrWrapCodeProvider = name;
    }
    if (ssr.wrapExports) {
      state.ssrWrapExports.push(...ssr.wrapExports);
    }
    if (ssr.wrapDefault !== undefined && state.ssrWrapDefault === undefined) {
      state.ssrWrapDefault = ssr.wrapDefault;
    }
  }

  // ── Runtime (OR-merge booleans, chain detectLocale) ──
  if (adapter.runtime) {
    const runtime: RuntimeAdapter = adapter.runtime;
    if (runtime.clientLocaleSync) state.clientLocaleSync = true;
    if (runtime.serverRequestScope) state.serverRequestScope = true;
    if (runtime.streamInjection) state.streamInjection = true;
    if (runtime.detectLocale) state.detectLocaleChain.push(runtime.detectLocale);
  }

  // ── Bundler (first-contributor-wins) ──
  if (adapter.bundler) {
    const bundler: BundlerAdapter = adapter.bundler;
    if (bundler.resolveVirtualPath !== undefined) {
      state.resolveVirtualPath = mergeHook(
        state.resolveVirtualPath,
        bundler.resolveVirtualPath,
        "bundler.resolveVirtualPath",
        state.resolveVirtualPathProvider,
        name,
      );
      if (!state.resolveVirtualPathProvider) state.resolveVirtualPathProvider = name;
    }
    if (bundler.dynamicImportTemplate !== undefined) {
      state.dynamicImportTemplate = mergeHook(
        state.dynamicImportTemplate,
        bundler.dynamicImportTemplate,
        "bundler.dynamicImportTemplate",
        state.dynamicImportTemplateProvider,
        name,
      );
      if (!state.dynamicImportTemplateProvider) state.dynamicImportTemplateProvider = name;
    }
    if (bundler.hmrInjectionCode !== undefined) {
      state.hmrInjectionCode = mergeHook(
        state.hmrInjectionCode,
        bundler.hmrInjectionCode,
        "bundler.hmrInjectionCode",
        state.hmrInjectionCodeProvider,
        name,
      );
      if (!state.hmrInjectionCodeProvider) state.hmrInjectionCodeProvider = name;
    }
    if (bundler.isMultiplex !== undefined) {
      state.isMultiplex = mergeHook(
        state.isMultiplex,
        bundler.isMultiplex,
        "bundler.isMultiplex",
        state.isMultiplexProvider,
        name,
      );
      if (!state.isMultiplexProvider) state.isMultiplexProvider = name;
    }
    if (bundler.fanBuildInputs !== undefined) {
      state.fanBuildInputs = mergeHook(
        state.fanBuildInputs,
        bundler.fanBuildInputs,
        "bundler.fanBuildInputs",
        state.fanBuildInputsProvider,
        name,
      );
      if (!state.fanBuildInputsProvider) state.fanBuildInputsProvider = name;
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

  return {
    codegenAdapters: state.codegenAdapters,
    extractionTargets: state.extractionTargets,
    extensions: state.extensions,

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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedAdapters {
  /** Pre-resolved capability flags — subsystems query this, never raw adapters */
  capabilities: ResolvedCapabilities;
  /** Merged, ready-to-call hooks — subsystems call these, never raw adapters */
  hooks: MergedAdapterHooks;
  /** The flat list of adapters after preset expansion (for debugging/introspection) */
  adapters: ZintlAdapter[];
}

/**
 * Resolve a list of adapter inputs (preset names or adapter objects) into
 * the pre-merged capabilities and hooks.
 *
 * This is the single entry point for the adapter system.
 * Called once during ZintlCompiler construction and cached.
 *
 * @example
 * const resolved = resolveAdapters(["react", "vite", "client-spa"]);
 * // resolved.capabilities.jsx === true
 * // resolved.capabilities.hmr === true
 * // resolved.hooks.dynamicImportTemplate("./foo", true) === "import(/* @vite-ignore *\/ \"./foo\")"
 */
export function resolveAdapters(inputs: (string | ZintlAdapter)[] = []): ResolvedAdapters {
  const flatAdapters: ZintlAdapter[] = [];
  for (const input of inputs) {
    flatAdapters.push(...expandInput(input));
  }

  const state = createEmptyState();
  for (const adapter of flatAdapters) {
    mergeAdapter(state, adapter);
  }

  return {
    capabilities: stateToCapabilities(state),
    hooks: stateToHooks(state),
    adapters: flatAdapters,
  };
}

// Re-export types that consumers need
export type {
  ZintlAdapter,
  ExtractionAdapter,
  CodegenAdapter,
  SsrAdapter,
  RuntimeAdapter,
  BundlerAdapter,
  ResolvedCapabilities,
  MergedAdapterHooks,
  SsrWrapParams,
  LocaleDetectionContext,
  MultiplexDetectionContext,
  TagMapEntry,
};
