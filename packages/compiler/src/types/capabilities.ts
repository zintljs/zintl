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
} from "@zintljs/extractor";
import type { IOManager } from "../managers/IOManager.js";
import type { CatalogManager } from "../managers/CatalogManager.js";
import type { ZintlLogger } from "./compiler.js";
import type { DeliveryBus } from "../bus/index.js";
import type { DependencyGraph, MetadataGraph, BoundaryGraph } from "./graph.js";
import type { Manifest } from "../reconcile.js";
import type { SourceMap } from "magic-string";

/**
 * The declarative extraction vocabulary, re-exported so that facet authors and
 * the host plugin can name these types without depending on `@zintljs/extractor`.
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
 * What a facet may ask about the project it is being resolved for.
 *
 * Deliberately small, and every field is something only the host can answer.
 * `bundler` is here because proposal 026 asked whether a facet needs to see its
 * host (§9 Q4) and then answered it: with two bundlers in play, the bundler
 * facets are the clearest case of a facet that must decide for itself rather
 * than be appended by core.
 */
export interface FacetActivationContext {
  /** Project root. Absolute. */
  root: string;
  /** Serving rather than building. */
  isDev: boolean;
  /** This build targets SSR. */
  isSsr: boolean;
  /** Which build tool is hosting the plugin — `"vite"`, `"rspack"`, … */
  bundler: string;
  /** Frameworks detected for this project. */
  frameworks: string[];
  /** Names of the host's other plugins. */
  pluginNames: string[];
  /** Merged `dependencies` + `devDependencies` + `peerDependencies`. */
  dependencies: Record<string, string>;
}

/**
 * A declarative activation condition.
 *
 * Data rather than a function on purpose. A predicate can only report *that* it
 * said no; a descriptor can report *why*, which is what makes the resolution
 * trace worth reading — and §10 is explicit that distributed activation without
 * an explain path is worse than the central switch it replaces.
 *
 * Every field is a narrowing condition, and all present fields must hold.
 * An omitted field is not a constraint.
 */
export interface FacetWhen {
  /** Active when any of these frameworks was detected. */
  framework?: string | string[];
  /** Active only when the build is (or is not) SSR. */
  ssr?: boolean;
  /** Active only in dev (`true`) or only in build (`false`). */
  dev?: boolean;
  /** Active when the host build tool is any of these. */
  bundler?: string | string[];
  /** Active when any of these packages is a project dependency. */
  dependency?: string | string[];
}

/**
 * The BaseFacet interface represents the base contract for all facets.
 * It defines the common properties that all facets must have.
 */
export interface BaseFacet {
  /** Unique facet identifier (e.g. "react-codegen", "vite-bundler", "ssr-node") */
  name: string;
  /** Discriminator type for this facet */
  concern: FacetConcern;
  /**
   * Resolving priority. Default: 0, System: 100. Higher priority overrides.
   *
   * This is the **declared specificity** §10 asks precedence to be sorted on.
   * It decides which facet wins a single-provider hook; it does not decide
   * whether a facet is active. Membership is {@link when} / {@link activate},
   * precedence is this — and neither depends on the order facets were
   * registered in.
   */
  priority?: number;

  /**
   * When this facet applies. Omitted means **always**, with no check performed.
   *
   * Most facets outside this repository will never set it: a facet someone adds
   * to their own project is there because they want it. It exists so the
   * built-in set can decide for itself instead of being mapped by a table in
   * core.
   */
  when?: FacetWhen;

  /**
   * Escape hatch for conditions {@link when} cannot express.
   *
   * Evaluated *after* `when` and only if `when` passed, so the two narrow
   * together. Prefer `when` where it fits — a facet activated by a predicate
   * can only be traced as "a function said yes".
   */
  activate?: (ctx: FacetActivationContext) => boolean;

  /**
   * Capability names this facet supplies, for {@link supersedes} to target.
   *
   * Lets one facet replace another without naming it directly — a Next.js facet
   * can supersede whatever provides `ssr:wrapping` rather than hardcoding
   * `"ssr-wrapping"`.
   */
  provides?: string[];

  /**
   * Facets this one replaces, by name or by a capability they `provide`.
   *
   * Activation is not a boolean (§10): a Next facet subsumes the generic SSR
   * and client-SPA facets, and independent predicates cannot express "I replace
   * you". A superseded facet is dropped even if its own condition held, and the
   * trace records which facet displaced it.
   */
  supersedes?: string[];

  /**
   * Facets this one cannot coexist with, by name or provided capability.
   *
   * Unlike {@link supersedes}, this is a hard error rather than a resolution —
   * for pairs where there is no sensible winner and silence would be worse than
   * a failed build.
   */
  conflicts?: string[];
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
   * Whether re-executing an entry module is safe.
   *
   * Zintl injects `import.meta.hot.accept()` into files that declare a trust
   * anchor, which are the files that mount. Accepting means the bundler
   * re-executes the module — and whether that is harmless is a property of the
   * framework, not of Zintl: setting `innerHTML` replaces, Svelte's `mount()`
   * appends a second copy, and React's `createRoot()` throws on a container it
   * already owns.
   *
   * A facet that mounts non-idempotently declares `false`, and the entry hands
   * its updates back to the bundler instead of pretending to have applied them.
   * Absent means `true`: the conservative direction is the one that keeps hot
   * updates working, and a framework that needs the other must say so.
   *
   * Merged pessimistically — one facet declaring `false` decides it, because a
   * project containing any non-replayable mount has one.
   */
  entryReexecutionSafe?: boolean;
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
  /**
   * Is this id one of Zintl's own generated modules, rather than a real source
   * file?
   *
   * The counterpart to {@link BundlerFacet.resolveVirtualPath}, and the half
   * that was missing. Core *constructs* virtual ids through a facet but used to
   * *recognise* them by testing for a `\0` byte directly, at seven sites — a
   * Rollup convention hardcoded into a bundler-agnostic layer.
   *
   * On Rspack that test is simply false: unplugin materialises virtual modules
   * as real files under `node_modules/.virtual/`. Nothing broke, because an
   * adjacent `id.includes("node_modules")` test happened to be true — the code
   * was right for the wrong reason, and would have started extracting strings
   * from Zintl's own generated catalogs the day unplugin moved that directory
   * (ledger L-004).
   *
   * Substring rather than prefix semantics, deliberately: boundary ids embed the
   * module id they were minted from, and several call sites ask this question of
   * a boundary id.
   */
  isVirtualId?: (id: string) => boolean;
  /** Custom dynamic import template (e.g. adds /* @vite-ignore *\/ comment) */
  dynamicImportTemplate?: (path: string, isDev: boolean) => string;
  /**
   * Can this host produce a per-locale HTML document — the "multiplex" fan-out
   * that `loadHook`/`resolveIdHook` implement (`packages/zintl/src/hooks/resolve.ts`)?
   *
   * True on Vite, where that fan-out exists end to end. Left undeclared
   * (falls back to `false`) everywhere else, deliberately: absence must not
   * read as "assume yes". On Rspack, the module that gates access to the
   * fan-out — `loadIncludeHook` claiming `.html` under multiplex — retypes the
   * raw template as `javascript/auto`, and the build dies inside
   * `html-rspack-plugin`'s child compilation on `<!doctype html>`. The claim
   * is destructive there, not merely wasted (ledger L-022). This flag is how
   * the host fences that claim from ever being made, instead of testing
   * `bundler === "rspack"` inside a bundler-agnostic hook.
   */
  htmlFanOut?: boolean;
  /**
   * How this host spells "accept my own updates", for **generated** modules.
   *
   * Distinct from {@link hmrInjectionCode}, which decorates a *source* file and
   * has to reason about whether re-executing an entry is safe. A generated
   * catalog or manager has no such question — it is Zintl's own code and always
   * safe to replace — but it does sometimes need to run something on update,
   * which the source-file hook cannot express.
   *
   * `callbackBody` receives `newModule` in scope when supplied.
   *
   * This exists because two call sites in the compiler hardcoded
   * `import.meta.hot` and consulted no facet at all, so every host was handed
   * Vite's API for its generated modules regardless of who was building. A
   * facet returning `""` declares that it has no hot-update story yet, which is
   * a better answer than the wrong API.
   */
  hmrSelfAcceptCode?: (callbackBody?: string) => string;

  /** HMR injection code generation (appended to transformed files in dev) */
  hmrInjectionCode?: (
    fileId: string,
    hmrToken: number,
    hasAnchors?: boolean,
    entryReexecutionSafe?: boolean,
  ) => string;
}

/**
 * Localizes files that are not modules — Markdown, HTML pages, anything whose
 * translations do not come from a boundary's extracted strings.
 *
 * Where an extraction facet says "here is how to find strings in this syntax",
 * a content facet owns a whole file type end to end: which files it claims,
 * what it emits for each locale, and what it remembers between runs. `match` is
 * the only required member; implement the rest as the file type needs.
 *
 * The lifecycle across a build is `setup` → `discover` (per matched file) →
 * `flush` → `getStateToSave`.
 */
export interface ContentFacet extends BaseFacet {
  concern: "content";
  /**
   * The facet's own state object, created once and reused across hooks.
   *
   * The usual pattern is a manager class holding whatever `discover` collects,
   * lazily constructed on first call.
   */
  getManagerInstance?: (context: CompilerContext) => unknown;
  /** Whether this facet owns `filePath`. The one required member. */
  match: (filePath: string, context: CompilerContext) => boolean;
  /**
   * Prepare for a build, given whatever the last run returned from
   * {@link ContentFacet.getStateToSave | `getStateToSave`} (`undefined` on a
   * cold start).
   */
  setup?: (savedState: unknown, context: CompilerContext) => Promise<void> | void;
  /** Register a matched file. Called once per file, before `flush`. */
  discover?: (filePath: string, context: CompilerContext) => Promise<void> | void;
  /** Emit everything for the discovered files — written output, catalog updates. */
  flush?: (context: CompilerContext) => Promise<void> | void;
  /** This facet's translations for `locale`, merged into the catalogs. */
  getTranslations?: (
    locale: string,
    context: CompilerContext,
  ) => Promise<Record<string, string>> | Record<string, string>;
  /** Whether `filePath` is output this facet produced, rather than a source file. */
  isLocalizedOutput?: (filePath: string, context: CompilerContext) => Promise<boolean> | boolean;
  /**
   * Every output path currently in use.
   *
   * What pruning consults before deleting a stale file, so an output that is
   * still live is never removed.
   */
  getActiveOutputPaths?: (context: CompilerContext) => Promise<Set<string>> | Set<string>;
  /** State to persist for the next run's `setup`. Must be JSON-serializable. */
  getStateToSave?: (context: CompilerContext) => unknown;
  /**
   * Boundary ids this facet owns that correspond to no source file.
   *
   * Content has no `zintl()` anchor of its own, so it needs a synthetic
   * boundary to hang catalogs on — the assets facet uses `"b_assets"`.
   */
  virtualBoundaries?: string[];
  /** The boundary a localized output file belongs to, or `null` if none. */
  getBoundaryForLocalizedOutput?: (
    filePath: string,
    context: CompilerContext,
  ) => Promise<string | null> | string | null;
  /**
   * Extra imports and catalog entries to fold into `locale`'s chunk, or `null`
   * to contribute nothing.
   */
  getChunkContributions?: (
    locale: string,
    context: CompilerContext,
  ) =>
    | Promise<{ imports: string[]; boundaryId: string; catalog: Record<string, any> } | null>
    | { imports: string[]; boundaryId: string; catalog: Record<string, any> }
    | null;
  /** Whether `boundaryId` is one of this facet's content boundaries. */
  isContentBoundary?: (boundaryId: string, context: CompilerContext) => boolean;
  /**
   * Catalog keys that must survive pruning.
   *
   * Content keys are not produced by extraction, so without this they look
   * orphaned and would be pruned away.
   */
  getProtectedCatalogKeys?: (
    boundaryId: string,
    context: CompilerContext,
  ) => Promise<string[]> | string[];
  /** Rewrite an HTML document on its way out — head tags, `lang`, preloads. */
  transformHtml?: (
    html: string,
    id: string,
    context: CompilerContext,
    preloads?: Record<string, string[]>,
  ) => Promise<string> | string;
  /**
   * Which locales this facet knows to be written right-to-left.
   *
   * Answers about **locales**, not about documents. Direction is a property of
   * a language, so a project with several HTML entries has one answer, not one
   * per page — the union across facets is what the runtime is handed.
   *
   * Core never learns what "rtl" means or which languages have it: it unions
   * string arrays. The knowledge lives here because the data does — direction
   * is authored per locale in content catalogs, and a facet is what knows how
   * to read its own.
   *
   * The alternative was a table in the runtime, which would have put a list of
   * RTL languages in compiler core — precisely the knowledge facets exist to
   * hold.
   */
  rtlLocales?: (context: CompilerContext) => Promise<string[]> | string[];
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

  /**
   * True when re-executing an entry module is safe for every facet in play.
   *
   * False as soon as one framework mounts non-idempotently — see
   * `RuntimeFacet.entryReexecutionSafe`.
   */
  entryReexecutionSafe: boolean;
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
  /** True when the active bundler facet can produce per-locale HTML documents (multiplex fan-out) */
  htmlFanOut: boolean;
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
  /** Resolved virtual-id recognizer — the counterpart of `resolveVirtualPath` */
  isVirtualId: (id: string) => boolean;
  /** Resolved dynamic import template */
  dynamicImportTemplate: (path: string, isDev: boolean) => string;
  /**
   * Resolved self-accept generator for generated modules (undefined if no
   * bundler facet supplies one, which means: emit nothing).
   */
  hmrSelfAcceptCode: ((callbackBody?: string) => string) | undefined;
  /** Resolved HMR injection code generator (undefined if no HMR facet) */
  hmrInjectionCode:
    | ((
        fileId: string,
        hmrToken: number,
        hasAnchors?: boolean,
        entryReexecutionSafe?: boolean,
      ) => string)
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
  /**
   * Delivery accounting (`docs/spec/ZDB.md`).
   *
   * A facet that performs ordered or repeatable work — a write, a flush
   * contribution, a lifecycle step — takes custody of it here rather than
   * relying on the surrounding sequential `await` to notice a failure.
   */
  bus: DeliveryBus;
  getDependencyGraph: () => DependencyGraph;
  getHive: () => Record<string, Record<string, string>>;
  markHiveDirty: () => void;
  getBoundaryGraph: () => BoundaryGraph | null;
  getMetadataGraph: () => MetadataGraph;
  internalManifest: Manifest;
  leadsToBoundary: (
    startId: string,
    dependencyGraph: DependencyGraph,
    metadataGraph: MetadataGraph,
  ) => { leads: boolean; dynamic: boolean; bakedLocale?: string };
  transform: (
    code: string,
    id: string,
    virtualInjectionTarget?: string,
    isDev?: boolean,
  ) => Promise<{ code: string; map: SourceMap } | undefined>;
}
