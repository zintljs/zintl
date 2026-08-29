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
import type { MessageContext } from "../message-context.js";

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
export type FacetConcern =
  | "extraction"
  | "codegen"
  | "runtime"
  | "ssr"
  | "bundler"
  | "content"
  | "exchange";

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
   *
   * `options.lang` is passed when the block is being authored *beside* one the
   * component already has, and must be mirrored exactly — Vue hard-errors with
   * "<script> and <script setup> must have the same language type". Called with
   * no options, the facet picks its own default, which is the case where the
   * component had no script block at all.
   */
  wrapSfcScript?: (code: string, options?: { lang?: string }) => string;
  /**
   * How this dialect makes a rendered translation **depend on** the store.
   *
   * React's components subscribe with `useSyncExternalStore`, injected into each
   * component function. A template dialect has no component function to inject
   * into, and — more importantly — subscribing would not be enough on its own:
   * Vue re-renders when a *reactive dependency it read during render* changes,
   * and `_t('…')` is an ordinary call to an ordinary function. A component can
   * be perfectly subscribed and still never redraw, because nothing it rendered
   * was reactive.
   *
   * So this contributes both halves:
   *
   * - `setup` establishes a reactive handle in the component's scope and keeps
   *   it in step with the store.
   * - `read` is spliced into every generated `_t` call, so rendering a
   *   translation *is* reading the handle. That is what closes the loop: the
   *   dependency is recorded during render, by construction, for every sink
   *   without the codegen having to find them.
   *
   * Without it a delivered catalog is invisible to the framework — measured on
   * Rspack, where nothing else re-runs the component (ledger L-069). Vite hid it
   * because its applier re-runs the entry on every boundary update, remounting
   * the tree against the new catalog for unrelated reasons.
   */
  reactiveBridge?: {
    /**
     * Statements establishing the handle, inserted into the component scope.
     *
     * Writes its own framework imports. `subscribe` and `getStoreVersion` are
     * added from the runtime for you; anything dialect-specific belongs here,
     * because where an import may legally sit is a property of the dialect —
     * declaring `vue` for the pipeline to place put it outside the SFC's
     * `<script setup>` block, which is not a valid single-file component.
     */
    setup: string;
    /** Expression every generated `_t` call reads, as an options-object value. */
    read: string;
  };
  /**
   * Do this dialect's template expressions resolve against the component
   * *instance* rather than the script block's lexical scope?
   *
   * Vue declares it: a plain `<script>` component compiles its template into a
   * separate render function, so `_t` and `_zintl_mgr_*` injected into that
   * block are invisible to the template and the page renders empty with
   * `_ctx._t is not a function` (ledger L-053). `<script setup>` compiles the
   * template against setup bindings, which is why it is the supported shape.
   *
   * Svelte leaves it undeclared: its `<script>` *is* the component scope.
   * Undeclared rather than `false`, per the convention {@link BundlerFacet.hotUpdate}
   * sets out — saying nothing is the honest form of saying no.
   */
  requiresScriptSetup?: boolean;
  /**
   * Wrap JSX children that contain rich HTML tags.
   * React: dangerouslySetInnerHTML={{ __html: ... }}
   */
  wrapJsxRichText?: (replacement: string) => string;
  /**
   * Interpolate a generated `_t` call into a surrounding template literal.
   *
   * The default is `${…}`, which is what a vanilla `el.innerHTML = ` template
   * needs: the result is assigned as HTML, so markup in the translation renders
   * as markup and nothing has to be said.
   *
   * Lit is where that stops being true. Its markup is also a template literal,
   * but an interpolated *string* is deliberately rendered as text — the escaping
   * is the security property — so a translation carrying `<code>` arrives on the
   * page with its tags visible. Opting out is the `unsafeHTML` directive, which
   * only this dialect can name.
   *
   * `hasTags` says whether the translation actually carries markup, so a dialect
   * can pay for the directive only where it is needed rather than on every
   * string.
   */
  wrapTemplateFragment?: (call: string, hasTags: boolean) => string;
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
  /**
   * Extra imports this dialect's *generated code* needs, keyed by module
   * specifier. Added whenever the file gets a `_t` — that is, whenever anything
   * this facet wrote is actually in it.
   *
   * Symmetric with {@link clientReactivityImports}, and separate from it for the
   * reason the two differ: that one is about *subscribing*, and is gated on
   * reactivity being injected. This is about what the emitted markup references,
   * which is a property of `wrapHtmlText` and friends.
   *
   * Lit is what made it necessary. Its rich-text form is
   * `${unsafeHTML(_t(…))}`, and `unsafeHTML` is an ordinary import from
   * `lit/directives/unsafe-html.js` — where React's `dangerouslySetInnerHTML`
   * and Svelte's `{@html}` are syntax and need nothing. Without this the facet
   * would have had to smuggle the import through `reactiveBridge.setup`, using a
   * reactivity seam to carry something that has nothing to do with reactivity.
   */
  codegenImports?: Record<string, string[]>;
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
  /**
   * Whether this framework distinguishes *server* components from client ones.
   *
   * Only React Server Components does, and there the `"use client"` directive is
   * what marks a module as allowed to use hooks — so reactivity may only be
   * injected into modules carrying it. Everywhere else, including plain React
   * SPAs and classic (non-RSC) SSR, **every component is a client component**
   * and the directive is not something anyone writes.
   *
   * Reading the directive unconditionally was the defect: `isClientComponent` is
   * literally `code.includes('"use client"')`, and gating reactivity on it meant
   * a plain React app never subscribed to the store at all. Measured across this
   * repository, exactly one file carried the directive — a Next.js example — so
   * the feature was reaching one module in the entire suite (ledger L-032).
   */
  serverComponents?: boolean;
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
   * Whether components built by this framework **redraw themselves** when a new
   * catalog reaches the store.
   *
   * The question a hot catalog update turns on, and a different one from
   * {@link entryReexecutionSafe}: that asks whether re-running the entry is
   * *safe*, this asks whether anything repaints without re-running it at all.
   * React reads the store through `useSyncExternalStore`; Vue's components
   * track it through its own reactivity. Svelte's compiled output and a plain
   * vanilla entry do neither — they paint once and the DOM is a snapshot.
   *
   * Where it is false, a delivered catalog is *applied and invisible*: the store
   * holds the new translation and the page keeps showing the text it painted
   * before the edit. That is not a hot update the user can perceive, so the host
   * is told to reload instead (ledger L-064).
   *
   * Absent means `false`, unlike `entryReexecutionSafe`, and the asymmetry is
   * deliberate. There the conservative direction keeps hot updates working; here
   * the conservative direction is to reload, because the failure mode of a
   * wrong `true` is a page that silently lies about its own contents while a
   * wrong `false` costs a page refresh.
   *
   * Merged optimistically — one facet declaring `true` decides it, since a
   * single reactive framework in the project is enough for its own components
   * to redraw.
   */
  repaintsOnCatalogUpdate?: boolean;
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
  /**
   * Can this host absorb a change to the boundary *graph* without reloading?
   *
   * ZHMR §4.2 routes a structural change — a new `zintl()` anchor, a new `$L`
   * colony — by asking the entry: where re-running it is safe, the re-executed
   * entry rebuilds the boundary map in place, and a reload would discard
   * application state to reach a state the update already reached. That is
   * `RuntimeFacet.entryReexecutionSafe`, and it is a **framework** fact.
   *
   * It is not the whole answer, because the host gets a veto. A new boundary is
   * a new catalog chunk, and on Rspack a changed entrypoint chunk set is a full
   * reload by construction: the dev server sends one before any plugin is
   * consulted. Measured — `plan.fullReload` is `false` for exactly the edits
   * that reload, so Zintl is not the one asking (ledger L-074).
   *
   * Absent means `true`: a host says so only when it cannot, the same polarity
   * as `entryReexecutionSafe`, because the common case is the capable one and a
   * silent default should not cost anyone a reload.
   */
  absorbsStructuralChange?: boolean;
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
   * Whether this host has a live-module-graph applier for hot updates.
   *
   * The facet's half of the seam proposal 029 built. The applier itself cannot
   * live here — it speaks Vite's `ModuleGraph` or Rspack's virtual file store,
   * and nothing bundler-specific belongs in the compiler — so it lives in
   * `packages/zintl/src/hmr/` and is contributed from that host's own escape
   * hatch. This flag is the part core, the composition guardrail and a fence can
   * see: *this bundler claims a hot-update story*.
   *
   * Distinct from {@link hmrInjectionCode} / {@link hmrSelfAcceptCode}, which say
   * how to spell acceptance in generated code. A host can emit perfectly correct
   * acceptance code and still have no way to tell its module graph that anything
   * changed; declaring both is what makes hot updates actually work, and the two
   * were separated exactly so a half-built host reads as half-built.
   *
   * Undeclared rather than `false` for a host with no story, per the convention
   * `rspackFacet`'s own `htmlFanOut` comment sets out: the merge treats the two
   * identically, so saying nothing is the honest form of saying no.
   */
  hotUpdate?: boolean;
  /**
   * Whether this host finds stale generated modules from their **declared file
   * dependencies** rather than by being handed a module list.
   *
   * The deepest difference between the two hosts, and the reason proposal 028
   * §6.1's sketched `applyInvalidation(affectedIds, hostGraph)` was the wrong
   * shape. Vite's hot-update hook is a *request*: it hands Zintl an event and
   * takes back the modules to update, so Zintl walks the graph and decides.
   * Rspack asks nothing — it rebuilds whatever its own dependency graph says is
   * stale, and a generated module that declares no dependencies is never stale
   * however loudly a hook shouts.
   *
   * A host that declares this gets `getBoundaryInputs()` reported as
   * `watchedFiles` from `generateVirtualModule`, and rebuilds the generated
   * catalog in the *same* compilation as the source edit that dirtied it.
   *
   * Undeclared on Vite deliberately, and not merely as redundancy: Vite is
   * already told exactly what to invalidate, and declaring the same catalog
   * files a second time makes Zintl's own `flush()` writes re-enter as source
   * changes — measured, as timeouts across every catalog-writing contract.
   */
  dependencyInvalidation?: boolean;
  /**
   * When this host compiles one block of a single-file component, does the
   * loader receive the **whole source file** or just that block?
   *
   * The two hosts answer differently, and the difference decides whether Zintl
   * may transform a sub-block request at all.
   *
   * On Vite, `@vitejs/plugin-vue` *loads* `App.vue?vue&type=template` as a
   * virtual module whose contents are the template block alone. Handing that
   * fragment to `transform()` would be asking the extractor to read a partial
   * document as an SFC, so those ids must be skipped — the whole file was
   * already transformed once, under its unsuffixed id, and the block is derived
   * from that result.
   *
   * On Rspack, `vue-loader`'s pitcher rewrites the block into a `-!` request
   * that **re-reads the original file** and runs the chain over it
   * (`rspack-vue-loader/dist/pitcher.js`, `genRequest`). So the loader is handed
   * the entire SFC, Zintl's transform is the right thing to run, and
   * `vue-loader` then selects the block out of the transformed source. Skipping
   * there means the parent request is transformed and thrown away while the
   * blocks that become code never are — an app that extracts correctly, builds
   * green, and renders the source locale (ledger L-051).
   *
   * Declared by the host rather than tested for, because "is this a sub-block
   * request" is a question about the bundler and `hooks/transform.ts` is
   * bundler-agnostic. Undeclared reads as `false`, which keeps Vite's behaviour
   * as the default — the conservative direction, since a wrong `true` feeds
   * fragments to the extractor and a wrong `false` only repeats work.
   */
  sfcBlockRequestsCarryWholeFile?: boolean;
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
   * `canRepaint` says whether **anything in the running page can act on a new
   * catalog** — a framework subscribed to the store, or a host that re-executes
   * the entry as part of applying the update. Accepting is only correct when
   * something downstream will redraw: an accept that nothing acts on *swallows*
   * the update, leaving a page whose store is right and whose DOM is a
   * screenshot of the previous one (ledger L-064). A facet that cannot repaint
   * should return `""` so the update bubbles to a reload instead — which is the
   * same trade L-035 made for source files, one module kind later.
   *
   * Hosts differ on this, which is why it is a facet decision rather than a
   * compiler one: Vite's applier explicitly invalidates the entry's own modules
   * on a boundary update, so the entry re-runs and repaints whatever the
   * framework does. Rspack's applier deliberately invalidates nothing and
   * rebuilds only what its declared dependencies mark stale, so a generated
   * catalog that accepts its own update is the end of the line.
   *
   * This exists because two call sites in the compiler hardcoded
   * `import.meta.hot` and consulted no facet at all, so every host was handed
   * Vite's API for its generated modules regardless of who was building. A
   * facet returning `""` declares that it has no hot-update story yet, which is
   * a better answer than the wrong API.
   */
  hmrSelfAcceptCode?: (callbackBody?: string, canRepaint?: boolean) => string;

  /** HMR injection code generation (appended to transformed files in dev) */
  hmrInjectionCode?: (
    fileId: string,
    hmrToken: number,
    hasAnchors?: boolean,
    entryReexecutionSafe?: boolean,
    /**
     * Whether anything on the page will repaint when a catalog arrives late —
     * i.e. whether a framework runtime subscribes to the store.
     *
     * Distinct from {@link entryReexecutionSafe}, which asks whether re-running
     * the entry is *harmless*. This asks whether it is *sufficient*, and the two
     * come apart per host. On Vite re-execution re-imports the whole chain, so
     * it always yields the current catalog. On Webpack a re-executed entry reads
     * its imports from the module cache, so it can seed itself from a manager
     * that has not been replaced yet — and with nothing subscribed to repair the
     * result, a non-reactive app renders empty and stays that way (L-030).
     *
     * Only answerable since L-034 stopped detection guessing React: before that
     * every project reported having reactivity, including ones with no
     * components at all.
     */
    hasClientReactivity?: boolean,
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
   * File extensions this facet claims (e.g. `[".md", ".txt"]`), for conflict
   * detection at construction.
   *
   * {@link ContentFacet.match | `match`} answers *"do you own this file?"* one
   * path at a time and can never answer *"which files do you own?"* — so two
   * content facets quietly claiming the same file were undetectable, while two
   * {@link CodegenFacet}s claiming `.tsx` have always been a hard error, purely
   * because codegen declares `extensions` and content did not. Proposal 034 §2.
   *
   * Optional and advisory: `match` stays the authority, and a facet whose
   * ownership only a predicate can express (a glob with no static extension, a
   * path-shape rule) declares nothing and is still matched normally. Declaring
   * buys the conflict check, not the matching.
   */
  extensions?: string[];
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
  /**
   * Whether this facet answers an import of `filePath` with a **per-locale URL**.
   *
   * Narrower than {@link ContentFacet.match | `match`}, and the two must not be
   * confused: the HTML projection facet *owns* `.html` and delivers nothing to an
   * importer, so a host that treated ownership as a licence to intercept fed an
   * HTML template to the JavaScript parser.
   *
   * Answer `true` only for a file whose import should resolve to a module that
   * follows the active locale. That excludes a request for the file's contents
   * (`?raw`), which is inline delivery, and a localized artifact, which is
   * already one locale's answer.
   */
  deliversUrl?: (filePath: string, context: CompilerContext) => boolean;
  /**
   * Outputs this facet scaffolded that nobody has filled in yet.
   *
   * The content half of `verifyIntegrity`, and the same statement it already
   * makes about strings: an empty catalog entry is a missing translation, and an
   * empty file is that statement about an artifact. A facet that scaffolds slots
   * for a person to author implements this, and the compiler folds the result
   * into the same integrity report under the same option (035 §5.1, §6).
   *
   * Its own hook rather than the generic catalog check, because a catalog value
   * cannot answer for every delivery mode — a referenced artifact's value is a
   * URL, which is non-empty whether or not the file behind it has any bytes.
   * The file is the thing to ask.
   */
  getUnfilledOutputs?: (
    context: CompilerContext,
  ) => Promise<{ locale: string; path: string }[]> | { locale: string; path: string }[];
  /** State to persist for the next run's `setup`. Must be JSON-serializable. */
  getStateToSave?: (context: CompilerContext) => unknown;
  /**
   * Boundary ids this facet owns that correspond to no source file.
   *
   * Content has no `zintl()` anchor of its own, so it needs a synthetic
   * boundary to hang catalogs on — the assets facet uses `"b_assets"`.
   */
  virtualBoundaries?: string[];
  /**
   * Every file this facet's {@link virtualBoundaries} are derived from, as
   * absolute paths — sources and their localized outputs alike.
   *
   * The answer to "what would change the catalog of a boundary that owns no
   * source". `boundaryOwnership` cannot supply it, because a virtual boundary
   * is *contributed* rather than extracted, so without this a generated module
   * embedding this facet's content declares no dependencies and is never stale
   * on a host that rebuilds from declared inputs. Ledger L-067.
   *
   * Synchronous, unlike {@link getActiveOutputPaths}: it is consulted while
   * building the watched-file list for a module that is being generated, on a
   * path with no await to spare.
   */
  getDeclaredInputs?: (context: CompilerContext) => string[];
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
    /** The host's public base path, so injected script can find the locale below it. */
    base?: string,
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
/**
 * One string, as it leaves for somewhere that is not this repository.
 *
 * Deliberately not a catalog entry. A catalog is `{ source: "translation" }`
 * and that shape is right next to the code, where the call site is a click
 * away; handed to a translator with no repo it cannot say whether *Open* is a
 * verb. Everything beyond `key` and `target` here exists to answer the
 * questions a catalog cannot (proposal 032 §2, §3).
 */
export interface ExportUnit {
  /** Content-derived message id — stable across a move or a rename. */
  id: string;
  /** The source text, which is also the catalog key. */
  key: string;
  /** The current translation, or `""` when there is none yet. */
  target: string;
  /**
   * Every boundary carrying this string, sorted.
   *
   * Plural, and that is 032 §8.1 rather than a convenience: context is metadata
   * and never a key, so one string reached through a `button` and a `title` is
   * **one** translatable unit annotated with both. Exporting it once per
   * boundary would ask a translator to translate the same words twice and let
   * them answer differently — and since the hive is keyed by source text
   * globally, the second answer would silently overwrite the first.
   */
  boundaryIds: string[];
  /** What the graph knows, from each place it appears. */
  contexts: MessageContext[];
  /**
   * Set when reconciliation carried a translation forward onto edited source.
   *
   * The export **states the answer** rather than leaving it open, which is the
   * whole of 032 §1: the hive and a TMS both have fuzzy matching, and two
   * translation memories guessing independently is a wrong-rename generator
   * that is miserable to debug because neither side is malfunctioning. Shipping
   * the carry-forward pre-filled and flagged means the TMS's matcher never gets
   * a turn.
   */
  carriedForward?: {
    /** The source text this translation was written against. */
    from: string;
    /** Levenshtein similarity, 0–1. */
    score: number;
    /** True when a whole word was swapped — the dangerous kind of near-match. */
    substitutesWords: boolean;
  };
}

/**
 * One translation coming back, before anyone has decided whether to believe it.
 *
 * `approved` is the facet's reading of its own format — XLIFF has segment
 * states, another format will have something else — and the *policy* built on
 * it is the compiler's: only an approved translation is imported (032 §8.2),
 * because a gate is worth having only while `translated` means exactly one
 * thing. A graded state entering a binary system would make a passing
 * `verifyIntegrity` stop meaning "this locale is done".
 */
export interface ImportedTranslation {
  locale: string;
  /** The source text, which is also the catalog key. */
  key: string;
  value: string;
  /** Whether the originating system considers this signed off by a human. */
  approved: boolean;
  /**
   * Set when the facet could not safely read this unit, with the reason.
   *
   * A transport-level refusal, folded into the same batched report the semantic
   * checks produce — because from the outside "your TMS returned a shape I
   * cannot read" and "your TMS dropped a placeholder" are one problem with one
   * owner. The alternative is guessing at a value, and a gate that guesses is
   * not a gate.
   */
  unreadable?: string;
}

/** Everything leaving for one target locale. */
export interface ExportBundle {
  sourceLocale: string;
  locale: string;
  units: ExportUnit[];
}

/**
 * Hands strings to a translation system, and takes them back.
 *
 * The seam proposal 032 §5 argues for, and the division is the same one the
 * bundler facets have: **the compiler contributes material, the facet
 * contributes serialization and transport.** Nothing in core knows what XLIFF
 * is, exactly as nothing in core knows what Rspack is, and a vendor facet can
 * be written by someone who is not us.
 *
 * The direction is forced rather than chosen. A TMS cannot know what a boundary
 * is — identity here is content-derived and computed from the import graph — so
 * making the TMS authoritative would mean giving it externally-owned keys, which
 * means abandoning content-based identity, which is the product. Zintl is not
 * integrating with a TMS; it is **lending strings to one and taking them back**.
 */
export interface ExchangeFacet extends BaseFacet {
  concern: "exchange";
  /**
   * Read translations back from wherever this facet sent them.
   *
   * Returns *proposals*, not decisions. The facet's job is transport — parse
   * the format, and say whether the originating system considers each unit
   * signed off. What happens next is the compiler's: 032 §4 makes the import a
   * **gate**, so a proposal is checked against the manifest before it is
   * allowed anywhere near a catalog.
   *
   * Called once per build, before catalogs are written, so anything accepted
   * counts toward `verifyIntegrity` in the same run.
   */
  import?: (context: CompilerContext) => Promise<ImportedTranslation[]> | ImportedTranslation[];
  /**
   * Write one locale's strings out.
   *
   * Called once per shipped non-source locale, in a production build only,
   * *before* `verifyIntegrity` runs — deliberately, because the moment an
   * export is most wanted is the build that is about to fail for missing
   * translations.
   */
  export?: (bundle: ExportBundle, context: CompilerContext) => Promise<void> | void;
}

export type ZintlFacet =
  | ExtractionFacet
  | CodegenFacet
  | SsrFacet
  | RuntimeFacet
  | BundlerFacet
  | ContentFacet
  | ExchangeFacet;

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
  /** See {@link BundlerFacet.absorbsStructuralChange}. */
  absorbsStructuralChange: boolean;
  repaintsOnCatalogUpdate: boolean;
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
  /** True when the active bundler facet declares a hot-update applier (proposal 029) */
  hotUpdate: boolean;
  /** True when the active bundler facet invalidates generated modules via declared file dependencies */
  dependencyInvalidation: boolean;
  /** True when the active bundler facet hands SFC sub-block requests the whole source file */
  sfcBlockRequestsCarryWholeFile: boolean;
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
  /** True when the framework separates server and client components (RSC). */
  serverComponents: boolean;

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
  hmrSelfAcceptCode: ((callbackBody?: string, canRepaint?: boolean) => string) | undefined;
  /** Resolved HMR injection code generator (undefined if no HMR facet) */
  hmrInjectionCode:
    | ((
        fileId: string,
        hmrToken: number,
        hasAnchors?: boolean,
        entryReexecutionSafe?: boolean,
        hasClientReactivity?: boolean,
      ) => string)
    | undefined;

  // ── Runtime hooks (chained) ──

  /** Chained locale detection (first non-undefined result wins) */
  detectLocale: ((context: LocaleDetectionContext) => string | undefined) | undefined;

  // ── Exchange hooks ──

  /** All registered exchange facets (proposal 032 §5). Empty unless one is configured. */
  exchangeFacets: ExchangeFacet[];

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
  /**
   * The locales this project **ships**.
   *
   * The safe default for a facet: it is what the runtime offers, what a
   * document is fanned out for, and what `verifyIntegrity` gates. A facet that
   * reads this and means it will never ship an untranslated locale.
   */
  locales: string[];
  /**
   * The locales this project **maintains catalogs for** — shipped and pending
   * alike (031).
   *
   * Read this instead of {@link locales} when the question is about a file on
   * disk rather than about output: which catalogs to write, which artifacts a
   * translator owns, what pruning must not delete. Equal to `locales` unless
   * the project declares `pendingLocales`.
   */
  maintainedLocales: string[];
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
