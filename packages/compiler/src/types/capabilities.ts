/**
 * The Capability Contract.
 *
 * This module is the vocabulary a facet author writes against, and the shape the
 * compiler is *handed*. It deliberately lives in the compiler **core**, not in
 * `../facet/`, because the direction of knowledge is one-way:
 *
 *   extractor  ←  compiler (core)  ←  compiler/facets  ←  zintl (plugin)
 *
 * The core defines what a capability *is*. It never learns what React, Vue,
 * Svelte, Next, Vite or SSR are — those live in `../facet/presets/`. It never
 * learns how facets are *selected* or *merged* either; that is the plugin's job.
 * The compiler simply receives a `CompilerCapabilities` and executes.
 *
 * Nothing under `src/index.ts`, `src/pipeline/`, `src/managers/` or `src/types/`
 * may import from `../facet/`. `__tests__/architecture.test.ts` enforces this.
 */
import type {
  TargetDescriptor,
  TargetPlugin,
  SfcRule,
  SfcBlockRule,
  SuppressionRule,
  MustacheRule,
  TagMapEntry,
  CompiledExtractionState,
} from "@zintl/extractor";
import type { IOManager } from "../managers/IOManager.js";
import type { CatalogManager } from "../managers/CatalogManager.js";
import type { ZintlLogger } from "./compiler.js";

/**
 * The declarative extraction vocabulary, re-exported so that facet authors and
 * the host plugin can name these types without depending on `@zintl/extractor`.
 * The plugin resolves facets and must be able to name `TargetDescriptor` to
 * merge them, but it must never take a dependency on the extractor.
 */
export type {
  TargetDescriptor,
  TargetPlugin,
  SfcRule,
  SfcBlockRule,
  SuppressionRule,
  MustacheRule,
  TagMapEntry,
  CompiledExtractionState,
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Interfaces (Facet Contracts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents the primary concern of a facet.
 * This is used to determine the priority of facets.
 */
export type FacetConcern = "extraction" | "codegen" | "runtime" | "ssr" | "bundler" | "content";

/**
 * The BaseFacet interface represents the base contract for all facets.
 * It defines the common properties that all facets must have.
 */
export interface BaseFacet {
  /** Unique facet identifier (e.g. "react-codegen", "vite-bundler", "ssr-node") */
  name: string;
  /** Discriminator type for this facet */
  concern: FacetConcern;
  /** Resolving priority. Default: 0, System: 100. Higher priority overrides. */
  priority?: number;
}

/**
 * Extraction layer — influences which strings are captured from source files.
 */
export interface ExtractionFacet extends BaseFacet {
  concern: "extraction";
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
export interface CodegenFacet extends BaseFacet {
  concern: "codegen";
  /** File extensions this codegen facet handles (e.g. [".tsx", ".jsx"]) */
  extensions: string[];
  /** Whether this codegen facet handles a given file path */
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
  /**
   * Extra imports the framework requires when the compiler injects automatic
   * client reactivity into a component, keyed by module specifier.
   *
   * React needs `useSyncExternalStore` from `"react"`. The compiler must not
   * know that, so the framework declares it here.
   */
  clientReactivityImports?: Record<string, string[]>;
}

/**
 * SSR layer — server-side rendering behavior.
 */
export interface SsrFacet extends BaseFacet {
  concern: "ssr";
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
export interface RuntimeFacet extends BaseFacet {
  concern: "runtime";
  /** Client-side locale sync (popstate, pushState monkey-patch, MutationObserver) */
  clientLocaleSync?: boolean;
  /** Server-side AsyncLocalStorage request scoping */
  serverRequestScope?: boolean;
  /** Stream injection for SSR HTML responses (Response, ReadableStream) */
  streamInjection?: boolean;
  /**
   * Custom locale detection from URL/request context.
   * Chained: first non-undefined result from any facet wins.
   */
  detectLocale?: (context: LocaleDetectionContext) => string | undefined;
}

/**
 * Bundler layer — build tool integration hooks.
 */
export interface BundlerFacet extends BaseFacet {
  concern: "bundler";
  /** Resolve virtual module paths (e.g. "virtual:zintl/..." → "\0virtual:zintl/...") */
  resolveVirtualPath?: (id: string) => string;
  /** Custom dynamic import template (e.g. adds /* @vite-ignore *\/ comment) */
  dynamicImportTemplate?: (path: string, isDev: boolean) => string;
  /** HMR injection code generation (appended to transformed files in dev) */
  hmrInjectionCode?: (fileId: string, hmrToken: number, hasAnchors?: boolean) => string;
}

export interface ContentFacet extends BaseFacet {
  concern: "content";
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
// Top-Level Facet Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Zintl Facet is the smallest independently composable unit of compiler behavior.
 * Every facet owns exactly one concern. The compiler itself is a microkernel that
 * derives its behavior entirely from the installed facet set.
 */
export type ZintlFacet =
  | ExtractionFacet
  | CodegenFacet
  | SsrFacet
  | RuntimeFacet
  | BundlerFacet
  | ContentFacet;

// ─────────────────────────────────────────────────────────────────────────────
// Resolved Output Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The immutable, pre-resolved capability flags.
 *
 * Resolved by the host plugin and handed to the compiler. Subsystems read this —
 * never raw facets.
 *
 * @example
 * // ✅ Correct: query the resolved view
 * if (world.capabilities.flags.streaming) { ... }
 *
 * // ❌ Anti-pattern: reaching into raw facets
 * if (facet.runtime?.streamInjection) { ... }
 */
export interface CapabilityFlags {
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

  /** True when any SSR facet is present */
  ssr: boolean;

  // ── Bundler Capabilities ──

  /** True when HMR injection is available */
  hmr: boolean;
  /** True when locale-based URL routing is expected */
  localeRouting: boolean;
}

/**
 * The pre-resolved compiler system view.
 *
 * Resolved by the host plugin alongside `CapabilityFlags`. Subsystems call into
 * this merged view instead of iterating facets.
 */
export interface CompilerSystemView {
  // ── Per-file codegen (matched by filePath) ──

  /** All registered codegen facets, to be matched per-file */
  codegenFacets: CodegenFacet[];

  // ── Extraction (union of all) ──

  /** Unified extraction targets from all facets */
  extractionTargets: TargetDescriptor[];
  /** Unified file extensions from all facets */
  extensions: string[];
  /** SFC rules from all facets */
  sfcRules: SfcRule[];
  /** Suppression rules from all facets */
  suppressionRules: SuppressionRule[];
  /** Mustache regex rules from all facets */
  mustacheRules: MustacheRule[];
  /** Framework imports required by injected client reactivity, keyed by specifier */
  clientReactivityImports: Record<string, string[]>;

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
  /** Resolved HMR injection code generator (undefined if no HMR facet) */
  hmrInjectionCode:
    | ((fileId: string, hmrToken: number, hasAnchors?: boolean) => string)
    | undefined;

  // ── Runtime hooks (chained) ──

  /** Chained locale detection (first non-undefined result wins) */
  detectLocale: ((context: LocaleDetectionContext) => string | undefined) | undefined;

  // ── Content hooks ──

  /** All registered content facets */
  contentFacets: ContentFacet[];
  /** All registered virtual content boundaries (e.g. ['b_assets']) */
  virtualBoundaries: string[];
  /** Unified catalog keys that must not be pruned from translation files */
  getProtectedCatalogKeys: (boundaryId: string, context: CompilerContext) => Promise<string[]>;
}

/**
 * Everything the compiler needs to know about its own behavior.
 *
 * This is the sole input through which framework, bundler and runtime knowledge
 * reaches the compiler. It is produced by the host plugin's facet resolution and
 * passed to `new ZintlCompiler({ capabilities })`. The compiler never builds one
 * itself — that would mean knowing which facets exist.
 */
export interface CompilerCapabilities {
  /** Pre-resolved capability flags — subsystems query this, never raw facets */
  flags: CapabilityFlags;
  /** Merged, ready-to-call system view — subsystems call this, never raw facets */
  system: CompilerSystemView;
  /** The flat list of facets (for debugging/introspection) */
  facets: ZintlFacet[];
  /** Pre-resolved extraction configuration */
  extraction: CompiledExtractionState;
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
