import type { TargetDescriptor, SfcRule, SuppressionRule, MustacheRule } from "@zintl/extractor";
import type { IOManager } from "../managers/IOManager.js";
import type { CatalogManager } from "../managers/CatalogManager.js";
import type { ZintlLogger } from "../types/compiler.js";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Interfaces (Contributions)
// ─────────────────────────────────────────────────────────────────────────────

export interface BaseContribution {
  /** Unique contribution identifier (e.g. "react-codegen", "vite-bundler", "ssr-node") */
  name: string;
  /** Discriminator type for this contribution */
  type: string;
  /** Resolving priority. Default: 0, System: 100. Higher priority overrides. */
  priority?: number;
}

/**
 * Extraction layer — influences which strings are captured from source files.
 */
export interface ExtractionContribution extends BaseContribution {
  type: "extraction";
  /** Target descriptors fed to the extractor (e.g. ["jsx:*:aria-label", "dom:prop:innerHTML"]) */
  targets: TargetDescriptor[];
  /** Additional file extensions to scan (e.g. [".vue", ".svelte"]) */
  extensions?: string[];
  /** SFC rules for block extraction */
  sfcRules?: SfcRule[];
  /** Suppression rules for ignored functions/vars */
  suppressionRules?: SuppressionRule[];
  /** Mustache variable parsing pattern */
  mustacheRegex?: RegExp;
}

/**
 * Codegen layer — per-file code generation behavior.
 */
export interface CodegenContribution extends BaseContribution {
  type: "codegen";
  /** File extensions this codegen adapter handles (e.g. [".tsx", ".jsx"]) */
  extensions: string[];
  /** Whether this codegen adapter handles a given file path */
  match: (filePath: string) => boolean;
  /** Whether this codegen adapter is an SFC */
  sfc?: boolean;
  /**
   * Wrap translated HTML text for template output.
   * Vue: v-html, Svelte: {@html}, React: dangerouslySetInnerHTML
   */
  wrapHtmlText?: (replacement: string, hasTags: boolean, hasVars: boolean) => string;
  /**
   * Wrap translated HTML attribute for template output.
   * Vue: :attr="...", Svelte: attr={...}
   */
  wrapHtmlAttribute?: (attrName: string, replacement: string, hasVars: boolean) => string;
  /**
   * Wrap injected code inside an SFC script block.
   * Vue: <script setup lang="ts">, Svelte: <script>
   */
  wrapSfcScript?: (code: string) => string;
  /**
   * Wrap JSX children that contain rich HTML tags.
   * React: dangerouslySetInnerHTML={{ __html: ... }}
   */
  wrapJsxRichText?: (replacement: string) => string;
  /**
   * Serialize a tag map for use in runtime _t() calls.
   * React needs template-literal tag open syntax; others use JSON.
   */
  serializeTags?: (tags: TagMapEntry[]) => string;
  /**
   * Convert JSX attribute syntax to HTML template literal syntax.
   * React: className="foo" → class="foo", attr={expr} → attr="${expr}"
   */
  convertToHtmlTemplate?: (tagOpen: string) => string;
  /**
   * Escape-quote function for string literals in SFC templates.
   * SFCs use single-quote with curly-brace escaping instead of JSON.stringify.
   */
  quoteLiteral?: (s: string) => string;
}

/**
 * SSR layer — server-side rendering behavior.
 */
export interface SsrContribution extends BaseContribution {
  type: "ssr";
  /** Entry point patterns to intercept for SSR wrapping */
  entryTargets?: (string | RegExp | ((id: string) => boolean))[];
  /**
   * Wrap the render function for request-scoped locale isolation.
   * Return the modified code string, or undefined to skip.
   */
  wrapCode?: (params: SsrWrapParams) => string | undefined;
  /** Named exports to wrap with request-scoped execution */
  wrapExports?: string[];
  /** Default export wrapping behavior */
  wrapDefault?: boolean | "fetch";
}

/**
 * Runtime layer — declares which runtime capabilities this adapter activates.
 */
export interface RuntimeContribution extends BaseContribution {
  type: "runtime";
  /** Client-side locale sync (popstate, pushState monkey-patch, MutationObserver) */
  clientLocaleSync?: boolean;
  /** Server-side AsyncLocalStorage request scoping */
  serverRequestScope?: boolean;
  /** Stream injection for SSR HTML responses (Response, ReadableStream) */
  streamInjection?: boolean;
  /**
   * Custom locale detection from URL/request context.
   * Chained: first non-undefined result from any adapter wins.
   */
  detectLocale?: (context: LocaleDetectionContext) => string | undefined;
}

/**
 * Bundler layer — build tool integration hooks.
 */
export interface BundlerContribution extends BaseContribution {
  type: "bundler";
  /** Resolve virtual module paths (e.g. "virtual:zintl/..." → "\0virtual:zintl/...") */
  resolveVirtualPath?: (id: string) => string;
  /** Custom dynamic import template (e.g. adds /* @vite-ignore *\/ comment) */
  dynamicImportTemplate?: (path: string, isDev: boolean) => string;
  /** HMR injection code generation (appended to transformed files in dev) */
  hmrInjectionCode?: (fileId: string, hmrToken: number, hasAnchors?: boolean) => string;
  /** Multiplex detection override (scans entry files for zintl("*") or zintl()) */
  isMultiplex?: (context: MultiplexDetectionContext) => boolean | undefined;
  /** Build input fanning for MPA multiplex (expands index.html → en/index.html, ar/index.html, etc.) */
  fanBuildInputs?: (
    inputs: Record<string, string>,
    locales: string[],
    root: string,
  ) => Record<string, string>;
}

export interface ContentContribution extends BaseContribution {
  type: "content";
  getManagerInstance?: (context: CompilerContext) => any;
  match: (filePath: string, context: CompilerContext) => boolean;
  setup?: (savedState: any, context: CompilerContext) => Promise<void> | void;
  discover?: (filePath: string, context: CompilerContext) => Promise<void> | void;
  flush?: (context: CompilerContext) => Promise<void> | void;
  getTranslations?: (
    locale: string,
    context: CompilerContext,
  ) => Promise<Record<string, string>> | Record<string, string>;
  isLocalizedOutput?: (filePath: string, context: CompilerContext) => Promise<boolean> | boolean;
  getActiveOutputPaths?: (context: CompilerContext) => Promise<Set<string>> | Set<string>;
  getStateToSave?: (context: CompilerContext) => any;
  virtualBoundaries?: string[];
  getBoundaryForLocalizedOutput?: (
    filePath: string,
    context: CompilerContext,
  ) => Promise<string | null> | string | null;
  getChunkContributions?: (
    locale: string,
    context: CompilerContext,
  ) =>
    | Promise<{ imports: string[]; boundaryId: string; catalog: Record<string, any> } | null>
    | { imports: string[]; boundaryId: string; catalog: Record<string, any> }
    | null;
  isContentBoundary?: (boundaryId: string, context: CompilerContext) => boolean;
  getProtectedCatalogKeys?: (
    boundaryId: string,
    context: CompilerContext,
  ) => Promise<string[]> | string[];
  transformHtml?: (
    html: string,
    id: string,
    context: CompilerContext,
    preloads?: Record<string, string[]>,
  ) => Promise<string> | string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-Level Adapter Interface & Presets
// ─────────────────────────────────────────────────────────────────────────────

export interface ZintlPreset {
  type: "preset";
  name: string;
  use: ZintlAdapterInput[];
}

export type ZintlAdapterInput = string | ZintlAdapter | ZintlPreset | ZintlAdapterInput[];

/**
 * A Zintl Adapter is a composable unit of concern.
 * Multiple adapters combine to form the resolved system behavior.
 */
export type ZintlAdapter =
  | ExtractionContribution
  | CodegenContribution
  | SsrContribution
  | RuntimeContribution
  | BundlerContribution
  | ContentContribution;

// ─────────────────────────────────────────────────────────────────────────────
// Resolved Output Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The immutable, pre-resolved capability map.
 * Built once during compiler construction. Subsystems read this — never raw adapters.
 *
 * Modeled after the extractor's ResolvedTargets pattern.
 *
 * @example
 * // ✅ Correct: query the resolved view
 * if (world.capabilities.streaming) { ... }
 *
 * // ❌ Anti-pattern: reaching into raw adapters
 * if (adapter.runtime?.streamInjection) { ... }
 */
export interface ResolvedCapabilities {
  // ── Codegen Capabilities ──

  /** True when at least one codegen adapter uses JSX-style output */
  jsx: boolean;
  /** True when at least one codegen adapter handles SFC files */
  sfc: boolean;
  /** True when JSX rich text wrapping is available (e.g. dangerouslySetInnerHTML) */
  jsxRichText: boolean;

  // ── Runtime Capabilities ──

  /** True when client-side locale sync is active (popstate, pushState, MutationObserver) */
  clientLocaleSync: boolean;
  /** True when server-side request scoping is active (AsyncLocalStorage) */
  serverRequestScope: boolean;
  /** True when SSR stream injection is active */
  streaming: boolean;

  // ── SSR Capabilities ──

  /** True when any SSR adapter is present */
  ssr: boolean;

  // ── Bundler Capabilities ──

  /** True when HMR injection is available */
  hmr: boolean;
  /** True when locale-based URL routing is expected */
  localeRouting: boolean;
}

/**
 * The merged, ready-to-use hook functions.
 * Built once during compiler construction alongside ResolvedCapabilities.
 * Subsystems call hooks here instead of iterating adapters.
 */
export interface MergedAdapterHooks {
  // ── Per-file codegen (matched by filePath) ──

  /** All registered codegen contributions, to be matched per-file */
  codegenAdapters: CodegenContribution[];

  // ── Extraction (union of all) ──

  /** Unified extraction targets from all contributions */
  extractionTargets: TargetDescriptor[];
  /** Unified file extensions from all contributions */
  extensions: string[];
  /** SFC rules from all contributions */
  sfcRules: SfcRule[];
  /** Suppression rules from all contributions */
  suppressionRules: SuppressionRule[];
  /** Mustache regex rules from all contributions */
  mustacheRules: MustacheRule[];

  // ── SSR hooks (merged, highest priority wins or conflict detection) ──

  /** Union of all SSR entry target patterns */
  ssrEntryTargets: (string | RegExp | ((id: string) => boolean))[];
  /** Resolved SSR code wrapper (single provider) */
  ssrWrapCode: ((params: SsrWrapParams) => string | undefined) | undefined;
  /** Union of all SSR named exports to wrap */
  ssrWrapExports: string[];
  /** Resolved SSR default export wrapping mode */
  ssrWrapDefault: boolean | "fetch" | undefined;

  // ── Bundler hooks (merged, highest priority wins or conflict detection) ──

  /** Resolved virtual path resolver */
  resolveVirtualPath: (id: string) => string;
  /** Resolved dynamic import template */
  dynamicImportTemplate: (path: string, isDev: boolean) => string;
  /** Resolved HMR injection code generator (undefined if no HMR contribution) */
  hmrInjectionCode:
    | ((fileId: string, hmrToken: number, hasAnchors?: boolean) => string)
    | undefined;
  /** Resolved multiplex detector (undefined to use default scan logic) */
  isMultiplex: ((context: MultiplexDetectionContext) => boolean | undefined) | undefined;
  /** Resolved build input fanner (undefined if no MPA contribution) */
  fanBuildInputs:
    | ((inputs: Record<string, string>, locales: string[], root: string) => Record<string, string>)
    | undefined;

  // ── Runtime hooks (chained) ──

  /** Chained locale detection (first non-undefined result wins) */
  detectLocale: ((context: LocaleDetectionContext) => string | undefined) | undefined;

  // ── Content hooks ──

  /** All registered content contributions */
  contentAdapters: ContentContribution[];
  /** All registered virtual content boundaries (e.g. ['b_assets']) */
  virtualBoundaries: string[];
  /** Unified catalog keys that must not be pruned from translation files */
  getProtectedCatalogKeys: (boundaryId: string, context: CompilerContext) => Promise<string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supporting Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SsrWrapParams {
  code: string;
  fileId: string;
  isEntry: boolean;
  locales: string[];
  sourceLocale: string;
}

export interface LocaleDetectionContext {
  /** Raw URL string or pathname */
  url?: string;
  /** Request object (framework-specific) */
  request?: unknown;
  /** Available locales */
  locales: string[];
  /** Default/source locale */
  defaultLocale: string;
}

export interface MultiplexDetectionContext {
  /** Vite resolved config (or equivalent) */
  config: unknown;
  /** Root directory */
  root: string;
  /** Configured locales */
  locales: string[];
}

export interface TagMapEntry {
  alias: string;
  originalOpen: string;
  tagName: string;
}

export interface CompilerContext {
  root: string;
  outputDir: string;
  sourceLocale: string;
  locales: string[];
  isDev: boolean;
  io: IOManager;
  logger: ZintlLogger;
  catalog: CatalogManager;
  getDependencyGraph: () => Record<string, any[]>;
  getHive: () => Record<string, Record<string, any>>;
  markHiveDirty: () => void;
  getBoundaryGraph: () => { entries: Set<string>; nodes: Map<string, any> } | null;
  getMetadataGraph: () => Record<string, any>;
  internalManifest: Record<string, any[]>;
  leadsToBoundary: (
    startId: string,
    dependencyGraph: Record<string, any>,
    metadataGraph: Record<string, any>,
  ) => { leads: boolean; dynamic: boolean; bakedLocale?: string };
  transform: (
    code: string,
    id: string,
    virtualInjectionTarget?: string,
    isDev?: boolean,
  ) => Promise<any>;
}
