import type { TargetDescriptor } from "@zintl/extractor";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extraction layer — influences which strings are captured from source files.
 * Merged across all adapters: targets and extensions are unioned.
 */
export interface ExtractionAdapter {
  /** Target descriptors fed to the extractor (e.g. ["jsx:*:aria-label", "dom:prop:innerHTML"]) */
  targets: TargetDescriptor[];
  /** Additional file extensions to scan (e.g. [".vue", ".svelte"]) */
  extensions?: string[];
}

/**
 * Codegen layer — per-file code generation behavior.
 * Multiple codegen adapters may coexist; each file matches at most one via match().
 */
export interface CodegenAdapter {
  /** File extensions this codegen adapter handles (e.g. [".tsx", ".jsx"]) */
  extensions: string[];
  /** Whether this codegen adapter handles a given file path */
  match: (filePath: string) => boolean;
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
 * System-wide. entryTargets and wrapExports are unioned; hook functions
 * (wrapCode) use first-contributor-wins with conflict detection.
 */
export interface SsrAdapter {
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
 * System-wide. Boolean fields are OR-merged. detectLocale is chained.
 */
export interface RuntimeAdapter {
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
 * System-wide. Hook functions use first-contributor-wins with conflict detection.
 */
export interface BundlerAdapter {
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

// ─────────────────────────────────────────────────────────────────────────────
// Top-Level Adapter Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Zintl Adapter is a composable unit of concern.
 * Multiple adapters combine to form the resolved system behavior.
 *
 * Adapters are per-concern, not per-framework-with-flags.
 * Example: ["react", "ssr", "vite"] composes three independent concerns.
 *
 * @example
 * // Minimal user-authored adapter (e.g. for Astro)
 * const astroAdapter: ZintlAdapter = {
 *   name: "astro",
 *   codegen: {
 *     extensions: [".astro"],
 *     match: (f) => f.endsWith(".astro"),
 *     wrapHtmlText: (r) => `{${r}}`,
 *   },
 *   ssr: {
 *     entryTargets: ["src/pages/"],
 *   },
 * };
 */
export interface ZintlAdapter {
  /** Unique adapter identifier (e.g. "react-codegen", "vite-bundler", "ssr-node") */
  name: string;

  /** How this adapter influences extraction (string targets, extra extensions) */
  extraction?: ExtractionAdapter;

  /**
   * How this adapter handles per-file code generation.
   * Multiple codegen adapters can coexist; each file matches at most one.
   */
  codegen?: CodegenAdapter;

  /** How this adapter handles server-side rendering */
  ssr?: SsrAdapter;

  /** What runtime capabilities this adapter contributes */
  runtime?: RuntimeAdapter;

  /** How this adapter integrates with the build tool */
  bundler?: BundlerAdapter;
}

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

  /** All registered codegen adapters, to be matched per-file */
  codegenAdapters: CodegenAdapter[];

  // ── Extraction (union of all) ──

  /** Unified extraction targets from all adapters */
  extractionTargets: TargetDescriptor[];
  /** Unified file extensions from all adapters */
  extensions: string[];

  // ── SSR hooks (merged, first-contributor-wins for functions) ──

  /** Union of all SSR entry target patterns */
  ssrEntryTargets: (string | RegExp | ((id: string) => boolean))[];
  /** Resolved SSR code wrapper (single provider) */
  ssrWrapCode: ((params: SsrWrapParams) => string | undefined) | undefined;
  /** Union of all SSR named exports to wrap */
  ssrWrapExports: string[];
  /** Resolved SSR default export wrapping mode */
  ssrWrapDefault: boolean | "fetch" | undefined;

  // ── Bundler hooks (merged, first-contributor-wins) ──

  /** Resolved virtual path resolver */
  resolveVirtualPath: (id: string) => string;
  /** Resolved dynamic import template */
  dynamicImportTemplate: (path: string, isDev: boolean) => string;
  /** Resolved HMR injection code generator (undefined if no HMR adapter) */
  hmrInjectionCode:
    | ((fileId: string, hmrToken: number, hasAnchors?: boolean) => string)
    | undefined;
  /** Resolved multiplex detector (undefined to use default scan logic) */
  isMultiplex: ((context: MultiplexDetectionContext) => boolean | undefined) | undefined;
  /** Resolved build input fanner (undefined if no MPA adapter) */
  fanBuildInputs:
    | ((inputs: Record<string, string>, locales: string[], root: string) => Record<string, string>)
    | undefined;

  // ── Runtime hooks (chained) ──

  /** Chained locale detection (first non-undefined result wins) */
  detectLocale: ((context: LocaleDetectionContext) => string | undefined) | undefined;
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
