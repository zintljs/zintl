# @zintl/compiler

## 0.1.0-alpha.8

### Minor Changes

- fe9fa30: Resolve runtime dev branches at build time via a `__ZINTL_DEV__` sentinel.

  Every development-only branch in the runtime was guarded like this:

  ```ts
  typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug;
  ```

  Vite does replace `process.env` — production output contained `{}.ZINTL_DEBUG === "true"`, proving it. But `typeof process !== "undefined"` sits in front of the replaceable part and cannot be folded, so in a browser it short-circuits to `false` before the replacement is ever reached. **Client-side debug logging has therefore never produced output**, and the guard added for safety was the exact thing defeating the build-time elimination it was meant to enable.

  `__ZINTL_DEV__` is now substituted to a literal `true`/`false` by `getRuntimeCode()`, driven by the plugin's `isDev`. A literal is the point: production folds the branch away entirely, development keeps it reachable — on the client as well as the server.

  - `getRuntimeCode()` takes a new trailing `isDev` argument, defaulting to `false` so a caller who forgets gets the production runtime. The failure mode is "no debug output", never "debug machinery shipped to users".
  - `I18nStore.debug` now also honours `globalThis.__ZINTL_DEBUG` in a browser. The env-var check alone is unreachable client-side, which is the second half of why client logging never appeared.
  - Adds a development-only settle beacon: `notify()` increments `globalThis.__zintl_version`, giving test harnesses a causal signal that the store applied something instead of making them sleep and hope. Absent in production by construction.

  Verified: production snapshots contain no `console.debug` and no `__zintl_version`, and `debug = typeof process !== "undefined" && {}.ZINTL_DEBUG === "true" || false` now compiles to `debug = false`.

  Consumers importing the runtime modules directly (rather than through `getRuntimeCode()`) must define `__ZINTL_DEV__` in their bundler or test config.

### Patch Changes

- fcd99bf: Report catalog-delivery failures instead of swallowing them.

  `loadLazyBoundary` discarded every failure mode it had: a rejected promise (`.catch(() => …)`), an empty result (`if (!res) return;`), and a synchronous throw (`catch {}`). All three cleared `pendingBoundaries` and scheduled no retry — so once delivery failed, `_t` returned `""` for every key in that boundary permanently, and nothing anywhere recorded why.

  An empty string is not a missing fallback; it is a read that returned the wrong value. The compiler's integrity check guarantees catalogs are complete, so a miss at runtime means _delivery_ failed, not content — and blank UI with no trace is the worst possible way to express that.

  All three sites now report in development, naming the boundary, the locale, and the consequence. Behaviour is otherwise unchanged: no fallback, no retry, no recovery invented. This makes a silent wrong-value read a loud one.

  Worth noting why this was never seen: the only diagnostic in the whole path was a `console.warn` gated on the old `typeof process !== "undefined"` guard, which never evaluated true in a browser. Client-side, this failure mode has been invisible for the project's entire life.

  Production output is unaffected — the logging is behind `__ZINTL_DEV__` and is eliminated at build time (verified: no such strings appear in any `dist` snapshot).

  - @zintljs/extractor@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- Rename the main package from `zintl` to `zintljs`.

  npm rejects the bare name `zintl` under its package-name similarity filter (`Package name too similar to existing packages intl,vinyl`). The name is unobtainable, so the primary package is now **`zintljs`**, matching the `@zintljs` npm org and the `zintljs` GitHub org.

  **What changed for consumers:**

  ```diff
  - npm install zintl
  + npm install zintljs

  - import zintl from "zintl/vite";
  - import { zintl } from "zintl/macro";
  + import zintl from "zintljs/vite";
  + import { zintl } from "zintljs/macro";
  ```

  **What did not change:** the `zintl()` macro itself. The package name and the exported identifier are deliberately separate — `ZINTL_MACRO` still resolves the `zintl(...)` call expression, and `bindings` in the boundary graph still read `"zintl"`. Only module specifiers moved.

  Internal `virtual:zintl/*` module IDs are unchanged; they are not npm names and keep the project's brand prefix.

  `RUNTIME_PACKAGE` and `RUNTIME_SPECIFIERS` in `@zintljs/extractor`, and `MACRO_PACKAGE` in `@zintljs/compiler`, now point at `zintljs`. Because those constants are baked into the compiler's published output, `@zintljs/compiler@0.1.0-alpha.6` cannot recognize the new specifiers and is superseded by this release.

### Patch Changes

- Updated dependencies
  - @zintljs/extractor@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- 2a07272: Introduced a modular, conflict-free **Adapter Architecture** that decouples framework-specific and toolchain-specific capabilities into discrete concerns. Framework presets (`"react"`, `"vue"`, `"svelte"`, `"vanilla"`, `"html"`, `"nextjs"`) and runtime/bundler layers (`"ssr"`, `"vite"`, `"client-spa"`) compose dynamically into a resolved capabilities map. Key changes include:

  - **Environmental Runtime Splitting**: Decomposed `store.ts` into environment-gated modules (`store-core.ts`, `store-client.ts`, and `store-server.ts`). Vanilla applications now bundle only core translation states, while SPA router synchronization popstates and server request-scoped `AsyncLocalStorage` logic are loaded dynamically on demand.
  - **Vite Plugin Decoupling**: Refactored the Vite plugin config hook to utilize the compiler's presets engine, auto-injecting the `"vite"` preset and detected frameworks, which cleans up hundreds of lines of duplicate codegen and SSR wrapper regexes.
  - **Extension Preservation**: Retained full source file extensions (like `.tsx`, `.jsx`, `.svelte`, and `.vue`) in the boundary ID normalization and compiler maps to prevent naming clashes between files sharing the same base name.
  - **Boundary & Catalog Alignment**: Resolved a bug causing duplicate catalog and schema files (e.g. `App.ar.json` vs `App.svelte.ar.json`) by passing pre-resolved extensions and adapters directly to the `IOManager` constructor to unify normalized paths.
  - **Backward Compatibility**: Embedded fallback translation from `options.targets` to their preset adapters to ensure full compatibility with existing configuration blocks.

- 4031237: Consolidated the facet configuration and instantiation pattern. Replaced static facet objects and custom creation helpers with standardized function factories named `nameFacet(options?)` (e.g., `vanillaFacet()`, `assetsFacet()`, `viteFacet()`). Introduced compound facet factories (e.g., `reactFacet()`, `vueFacet()`, `htmlFacet()`, `nextjsFacet()`, and `ssrFacet()`) to return a flattened list of concerns under a single configuration entry. Relocated all preset automation and auto-resolution logic from the compiler core to the Vite plugin, making the compiler entirely logicless. Finally, renamed `ZintlOptions` to `CompilerOptions`, and re-exported all facet factories directly from the `zintl` plugin package so users do not need to install the compiler package to customize facets.
- 5be8d95: Moved facet resolution out of the compiler and into the host plugin, completing the separation the Concern-Faceted Architecture was aiming at. Knowledge now flows one way only: `extractor ← compiler (core) ← compiler/facets ← zintl (plugin)`. The compiler receives capabilities and executes them; it no longer selects, merges, validates or names a framework.

  **Compiler API.** `new ZintlCompiler(options)` now requires `options.capabilities`. `CompilerOptions.facets` and the internal `CompilerFacetInput` type are removed, and `resolveFacets` is no longer exported from `@zintljs/compiler`.

  ```ts
  // before
  new ZintlCompiler({ facets: [reactFacet(), viteFacet()] });

  // after
  import { resolveFacets } from "zintl/facets";
  new ZintlCompiler({
    capabilities: resolveFacets([...reactFacet(), viteFacet()]),
  });
  ```

  **Capability contract relocated to the compiler core.** All facet interfaces moved from `src/facet/types.ts` to `src/types/capabilities.ts` and are published from the package root. Renames: `ResolvedFacets` → `CompilerCapabilities`, `ResolvedCapabilities` → `CapabilityFlags`, `ResolvedFacetSystem` → `CompilerSystemView`. The bundle's boolean map is now reached as `capabilities.flags` rather than `capabilities.capabilities`.

  **Removed the `VITEST` facet injection.** The constructor silently pushed `htmlFacet()`, `assetsFacet()`, `vanillaFacet()` and `reactFacet()` whenever `VITEST=true` or `NODE_ENV=test`, so the compiler behaved differently under test than in production. This is why no compiler test ever passed a facet list. The facet set is now declared explicitly by the test harness.

  **Fixes uncovered by the move:**

  - **`ZintlFacet` was declared twice**, once in `dist/index.d.mts` and once in `dist/facet/index.d.mts`. Because `CompilerContext` reaches `IOManager` — a class with private fields — the two declarations were _nominally_ incompatible, which is what forced `as FacetsInput` casts on user-authored facets. `@zintljs/compiler/facets` now exports preset values only and imports the single canonical type declaration; the casts are no longer needed.
  - **The compiler hardcoded React.** `pipeline/resolve-imports.ts` injected `import { useSyncExternalStore } from "react"` for client components. Frameworks now declare this through the new `CodegenFacet.clientReactivityImports` field.
  - **`CatalogManager` and `GraphManager` hardcoded** `[".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html"]` when probing extensionless dependency ids; both now use the resolved extension list, exposed via `IOManager.resolvedExtensions`.
  - **`resolveTargets` returns a shared, memoized object** that the old resolver mutated in place, so two compilers with identical descriptors but different facet rules could clobber each other's extraction state. The new `compileExtractionState` export (also the seam that keeps the plugin free of an `@zintljs/extractor` dependency) builds the state immutably.
  - **`MergeState.hmrInjectionCode`** dropped the `hasAnchors` parameter that both `BundlerFacet` and the resolved view declare.

  **Removed two unreachable bundler hooks.** `BundlerFacet.isMultiplex` had no provider and was shadowed by `Context.getMultiplex`. `BundlerFacet.fanBuildInputs` was not merely unused but architecturally unreachable: MPA input fanning happens in the `config` hook, which runs before `configResolved` constructs the compiler, so a facet's copy could never be consulted.

  **Plugin.** `zintl/facets` now exports `resolveFacets`, plus `assembleFacets`, `autoFacets`, `flattenFacets`, `detectFrameworks`, `detectFrameworksOrFallback` and `FALLBACK_FRAMEWORK`. Framework detection and facet assembly moved out of `configResolved` into `facets/detect.ts` and `facets/assemble.ts`, leaving the hook as three visible steps: detect → assemble → resolve. The plugin's public `Options` now extends `Omit<CompilerOptions, "capabilities">`.

  **`@zintljs/testing`.** `ViteDriver.compile()` resolves capabilities the same way the plugin does instead of handing plugin-shaped options straight to the compiler. The contract snapshots consequently measure the production path for the first time — which revealed that `vue-basic` and `svelte-basic` had been asserting that Zintl performs _no_ transformation on Vue and Svelte components (the test-mode injection gave every example React facets), and that `react-basic`, `react-ssr` and `vanilla-spa-basic` were recorded with no bundler facet at all, so dev dynamic imports lacked their `/* @vite-ignore */` comment. 15 snapshots were regenerated against the correct output.

  **Enforcement.** Two architecture tests assert that no file under `src/index.ts`, `src/pipeline/`, `src/managers/` or `src/types/` imports from `./facet/**`, and that the compiler core names no framework or bundler. The 42 test files that require a resolved framework world moved to the plugin package, where resolution lives.

- 1061058: Refactored the compiler extension model from Adapters to Facets, formalizing the Concern-Faceted Compiler Architecture and Dimension-Constrained composition system. Renamed `ZintlAdapter` to `ZintlFacet`, `resolveAdapters` to `resolveFacets`, and the `adapters` configuration options to `facets` across the compiler, plugin, examples, and tests.
- 448dbc6: Made `@zintljs/extractor` genuinely framework-blind. A previous changeset claimed the extractor had been "fully decoupled" from framework presets; that was inaccurate — the tables were left in place, duplicating the facet presets, and one of them was still on a live code path.

  **Deleted from `targets.ts`:**

  - `TARGET_PRESETS` — full descriptor lists for `vanilla`, `react`, `nextjs`, `vue`, `svelte` and `html`.
  - `TARGET_METADATA` and the `TargetMetadata` type — Vue and Svelte SFC block rules, Svelte's mustache pattern, and the Next.js `generateMetadata` / `generateViewport` suppression rules.
  - `DEFAULT_SFC_RULES` and `DEFAULT_SUPPRESSION_RULES`.

  Every one of these duplicated a facet preset in `@zintljs/compiler/facets`, which is now the single source of truth. The Vue and Svelte block rules were byte-identical to their preset counterparts.

  **Removed the one live leak.** `parser.ts` fell back to `DEFAULT_SFC_RULES` whenever the caller's rules did not cover a file's extension, so any `.vue` or `.svelte` file received Vue/Svelte block-splitting from the extractor itself even when no rules were supplied. SFC rules are now caller-supplied only.

  **`TargetDescriptor` no longer names a framework.** The `"auto" | "react" | "nextjs" | "vue" | "svelte" | "html" | "vanilla"` members are gone, leaving only the structural forms (`jsx:*:attr`, `jsx:El:attr`, `dom:prop:x`, `dom:attr:x`, `obj:field:x`, `html:attr:x`) and `TargetPlugin`. `resolveTargets` is correspondingly reduced to pure structural compilation — descriptors into lookup sets, plugin collection and a fast-path regex — with no preset expansion and no rule derivation.

  **No default target set.** `parser.ts` and `context.ts` both defaulted to `["vanilla", "react", "html"]`. A framework-blind executor has nothing sensible to guess, so callers now declare their sinks; production supplies a fully compiled state from the resolved facets.

  **Removed dead sink opinions.** `DEFAULT_UI_ATTRIBUTES`, `DEFAULT_UI_OBJECT_FIELDS`, `DEFAULT_UI_SINK_PROPERTIES` and `TEMPLATE_ATTR_REGEX` encoded which DOM and JSX attributes are translatable. All four were already unreferenced — one survived only inside a commented-out line.

  **Fixed drifted runtime-specifier detection.** The check for Zintl's own module specifiers was inlined at four sites (`parser.ts`, two in `visitors/program.ts`, one in `visitors/bindings.ts`) and the copies had diverged: the `bindings.ts` variant omitted the bare `"zintl"` literal, so a project configuring a custom `runtimePackage` would have had bare `"zintl"` imports recognised by three checks and missed by the fourth. All four now call the new `isRuntimeSpecifier` helper, backed by a single `RUNTIME_SPECIFIERS` list.

  **Verification.** The contract snapshots passed with zero diffs, which is the proof that the deleted tables were dead in production. Three new architecture tests assert that the extractor names no framework anywhere in its source, exposes no preset tables, and that `resolveTargets([])` yields a genuinely empty world.

- e1e504d: Prepare the packages for their first public release.

  - **Renamed the npm scope** from `@zintl/*` to `@zintljs/*`. The `zintl` org name was unavailable on npm; the primary package remains `zintl`, so application code importing `zintl` and `zintl/macro` is unaffected. Only direct consumers of `@zintl/compiler` and `@zintl/extractor` need to update.
  - **Corrected the Vite peer range** to `^6.0.0 || ^7.0.0 || ^8.0.0`, verified by building a real app against stock Vite 6.4.3, 7.3.6, and 8.2.0. The plugin relies on the Environment API (`hotUpdate`, `this.environment`), which does not exist in Vite 5, so the previous `^5.0.0` range advertised support that could never work.
  - **Pinned `oxc-parser` and `@oxc-project/types`** to `^0.142.0` in the workspace catalog. They were set to `latest`, which would have published `@zintljs/extractor` with an unpinned runtime dependency on a pre-1.0 parser.
  - **Trimmed the publish surface** with an explicit `files` field. The `zintl` tarball drops from 91 files (535 kB unpacked) to 13 files (103 kB) — build config and sources are no longer shipped.
  - **Added `engines`, `repository`, `homepage`, `bugs`, and `keywords`** to every published package, and gave `@zintljs/compiler` and `@zintljs/extractor` their own READMEs.
  - **Moved npm provenance out of `publishConfig`** so that publishing is possible outside of CI. Provenance requires a public source repository and CI OIDC; it is re-enabled via `NPM_CONFIG_PROVENANCE` in the release workflow.
  - **Marked `@zintljs/testing` as private.** It backs the internal e2e suite only and is no longer part of the release surface.

- 3fa4428: Hardened catalog reconciliation — the subsystem that decides, when source text changes, whether a translation is carried forward or dropped. Because keys derive from the text itself, this is what makes ordinary copy edits safe, and it had three unit tests.

  **Its two failure modes are not symmetric, and the design now says so.** A _missed_ rename is cushioned: the translation hive is append-only and keyed by source text globally, so the old translation is never destroyed and `CatalogManager` restores it if that text reappears. A _wrong_ rename is not cushioned — the old translation is written under the new source text and then memorized into the hive, so one bad match propagates. Everything below follows from that asymmetry.

  **Carry-forwards are now reported.** `ReconcileResult` gains a `renamed` array recording every rename with its similarity score and a `substitutesWords` flag, and `MessageManager` surfaces them: a warning when a whole word was swapped, debug otherwise. Deletes stay quiet, because the hive already covers them.

  The flag is a risk signal, never a rejection. Edit distance cannot separate `"Enable notifications"` from `"Disable notifications"` — they are ~0.86 similar — and no threshold can, since a negation and a spelling fix are the same edit size. But a negation _substitutes a word_ while a typo fix, a punctuation change or an appended clause does not, so that shape is worth a developer's eyes. A single-word spelling fix (`"Colour"` → `"Color"`) trips it too; it still reconciles, it is just visible.

  **Matching is deterministic.** Renames were assigned by walking removed texts in manifest order and taking each one's best available partner. When two removed strings competed for the same partner, iteration order decided which kept its translations. Candidate pairs are now scored globally and assigned best-first, with ties broken on text, so the outcome is a pure function of manifest _content_ rather than ordering — and the greedy result is strictly better matched.

  **Short strings no longer fall off a cliff.** Similarity is length-relative, so `"OK"` → `"Ok"` was one edit over two characters — 0.5, under the 0.6 threshold — and a casing fix on a two-letter button was classified as a delete. The new `isRenameCandidate` applies a one-edit floor. This only ever relaxes the budget, and only where the ratio rounded below a single edit, so nothing three characters or longer changes behavior.

  **Separated two thresholds that had been conflated.** The assets facet's fuzzy matching now uses its own `DEFAULT_ASSET_DRIFT_THRESHOLD` rather than borrowing `DEFAULT_RENAME_THRESHOLD`. One asks "is this the same UI string, edited?" over short labels; the other asks "did this document change materially?" over whole file bodies. They share a value today and are now free to diverge.

  **Tests went from 3 to 26**, and are grouped around the asymmetry: the short-string budget, word-substitution reporting, and a property block covering classification exhaustiveness (every removed text lands in exactly one of rename/move/delete), invariance under manifest and boundary ordering, one-partner-per-text, closest-partner preference, no-op on unchanged manifests, and similarity symmetry.

### Patch Changes

- 448dbc6: Gave Zintl's option defaults a single home. Defaults were previously applied lazily at roughly thirty read sites across two packages, several of them duplicated with divergent rules, so answering "where did this value come from?" meant grepping.

  **`resolveOptions()` is now real.** It had been a stub whose entire body was commented out, returning `options || {}`. It now applies every context-free default once, at plugin creation, and `Context` holds the resulting `ResolvedOptions` so downstream hooks read concrete values. A new exported `DEFAULTS` table is the one place a default is written down.

  | default                               | occurrences before | after            |
  | ------------------------------------- | ------------------ | ---------------- |
  | `locales \|\| ["en"]`                 | 9                  | 0                |
  | `sourceLocale \|\| "en"` (plugin)     | 4                  | 0                |
  | `similarityThreshold ?? 0.6` literals | 3                  | 0                |
  | `["md", "txt"]` literals              | 2                  | 1 named constant |
  | harness default blocks                | 2                  | 1                |

  **Three defaults stay unresolved on purpose**, because only Vite can supply them. Each is documented in `DEFAULTS` and applied at exactly one site: `multiplex` (`undefined` → auto-detect by scanning entry files), `verifyIntegrity` (`undefined` → on for `build`, off for `serve`) and `logLevel` (`undefined` → fall back to Vite's own, then `"info"`). `logLevel` previously had three stacked defaulting layers and `verifyIntegrity` three rules that disagreed, one of which relied on spread ordering to let a user value win.

  `outputDir`, `catalogFormat`, `metadataDir` and `similarityThreshold` are deliberately left unset by the plugin so the compiler applies its own — re-stating them would recreate the duplication being removed.

  **Fixed a shared-array aliasing bug** found while writing the new tests: the default `locales` array was a single instance handed to every caller, so one plugin instance mutating its locale list would corrupt another's. Array defaults are now copied per call.

  **Compiler-side deduplication.** `DEFAULT_RENAME_THRESHOLD` is exported from `reconcile.ts` and reused by the assets facet, which had hardcoded `0.6` three times. The assets facet's `["md", "txt"]` default is a named constant instead of two inline literals. `AssetFacetConfig` drops its `assetsTarget` alias, so the concept is spelled `targets` at the facet level and `assetsTarget` at the plugin level, bridged in exactly one commented line in `facets/assemble.ts` — previously three spellings reconciled by a rename inside the factory. `IOManager` takes a narrow `IOManagerOptions` (just `metadataDir`) rather than the whole `CompilerOptions`, and its duplicated metadata-directory resolution is collapsed into one method.

  **Removed dead configuration.** The `ZINTL_TEST_OUTPUT_DIR` / `ZINTL_TEST_METADATA_DIR` environment overrides were read in `configResolved` but nothing in the repository ever set them. The test harness's Vite alias pointing at `packages/runtime/src/*` referenced a directory that does not exist.

  **New coverage** for territory that had none: `resolveOptions` pins every documented default and asserts that falsy user values survive, and `flattenFacets` / `autoFacets` / `assembleFacets` are tested directly — including that `viteFacet()` is always injected and that the generic SSR facet is never paired with Next.js, which would otherwise be a facet conflict.

- 51261a9: Decoupled static asset localization (`AssetManager`) and HTML catalog/schema projection (`HtmlManager`) from the hardcoded execution paths of the compiler. Created the generic `ContentAdapter` interface and a stable `CompilerContext` API, migrating the manager behaviors into pluggable system content adapters (`staticAssetsAdapter` and `htmlProjectionAdapter`).
- 7e02023: Fully decoupled the remaining hardcoded knowledge of assets and HTML projections below the adapter resolution layer. Refactored `CatalogManager` and `GraphManager` to genericize virtual boundary tracking and content checks via resolved content adapter hooks, eliminating direct imports and usage of manager classes in the compiler core.
- 3fd61d3: Ensure deterministic boundary and chunk graph serialization by implementing deterministic sorting helpers:

  - **Deterministic Serialization**: Added the `serializeDeterministic` utility to recursively format and sort `Map` keys, `Set` elements, and arrays of objects (such as `BoundaryDep` lists) by stable properties (e.g. `id` or `name`).
  - **Strict ESLint Compliance**: Included a localized string comparison helper `compareStrings` to satisfy array sort checks without the performance overhead of Unicode-based `localeCompare`.
  - **Contract Tests Snapshot Stability**: Updated the contract graph test suite to utilize the new deterministic serializer, preventing random reordering failures on successive test runs.

- a7f080f: Fully decoupled high-level framework presets (`"vue"`, `"svelte"`, and `"nextjs"`) from `@zintljs/extractor`'s core logic. The extractor has no hardcoded references to these framework target-presets, meaning all SFC block parsing rules, metadata suppression rules, and mustache regular expression patterns now flow downward from compiler-resolved adapters.

  Evolved the extractor's mustache rule matcher to dynamically match intermediate or virtual file extensions (e.g. `.vue.html` and `.svelte.html`) to ensure correct template variable extraction and production catalog baking in Vue and Svelte.

- fdda8fa: Refactored the compiler and Vite plugin wrapper to establish a fully adapter-driven modular architecture. Eliminated hardcoded fallbacks for extensions in the plugin wrapper config resolved hooks. Preserved physical JSON catalog formats for robust schema-enforcements, auto-healing, and recovery. Added support for custom Handlebars SFC template block extraction and dynamic runtime multi-brand slogans resolution, utilizing robust regex rewriter hooks. Added type definitions for SFC identification on codegen contributions. Unified the HTML projection preset adapter with the compiler's extraction manifest to merge standard extracted text keys and metadata (such as titles, descriptions, and directions) into the generated schemas, resolving validation conflicts under `additionalProperties: false`.
- 72acaa8: Expanded SSR entry point file extension matching in the compiler presets to support JSX/TSX:

  - **SSR JSX/TSX Entry Wrapping**: Added support for `.tsx` and `.jsx` file extensions when detecting and wrapping server entry points inside `runInRequestScope` in the `ssr` and `nextjs` presets.

- Updated dependencies [448dbc6]
- Updated dependencies [a7f080f]
- Updated dependencies [e1e504d]
  - @zintljs/extractor@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- 3ceeaf3: Upgrade the Zintl compiler to fully support backing up, restoring, and similarity matching (fuzzy reconciliation) of static translation assets in the global Hive:

  - **Move & Rename Auto-Recovery**: Stored asset targets indexed by their source content hash (`@zintl/asset-hash:<sha1>`) instead of absolute paths. This allows automatic translation restoration at the new location when a source asset is moved or renamed.
  - **Binary/Image Asset Backups**: Implemented Base64 encoding/decoding to safely back up localized binary assets in `hive.json` and restore them back as raw binary buffers.
  - **Target Pruning**: Updated the asset manager to proactively delete localized target files from disk when their source asset is deleted or moved, working seamlessly in development/HMR mode.
  - **Fuzzy Modification Reconciliation**: Implemented Levenshtein-based similarity matching for text and Markdown assets. If a source asset changes slightly (either at the same path or during a move), Zintl now preserves the translator's existing translation and prepends a review warning rather than overwriting it entirely.

- a16cedd: Evolved the compiler to be completely framework-agnostic (zero-knowledge) by eliminating all default `.vue` and `.svelte` fallbacks from the core extensions and search paths. Configured the host Vite plugin to dynamically calculate target extensions and pass them to the compiler. Refactored the React target adapter matching rule to dynamically exclude registered SFC extensions and HTML files without hardcoding Vue or Svelte.

  Abstracted dynamic imports and virtual module paths inside the compiler. Added `resolveVirtualPath` and `dynamicImportTemplate` options callbacks, allowing any host bundler plugin to configure custom virtual namespaces (e.g. queries) and ignore-comments (e.g. webpackIgnore/vite-ignore) dynamically.

- b7a327e: Fixed HMR rendering issues and resolved timing race conditions during source translation updates:

  - Updated the translation resolver (`_t`) to immediately re-evaluate catalog lookups after synchronous self-registration, preventing blank rendering.
  - Propagated HMR timestamps (`lastHMRTimestamp`) on all invalidated virtual modules in `handleHotUpdate` to ensure Vite's `importAnalysis` rewrites imports with correct timestamp query parameters.
  - Introduced automated page auto-refresh (full-reload) for server-side (SSR) only boundaries and catalogs when modified.

- 97733bb: Fix phantom boundary integrity errors and phantom asset output for projects without a `zintl()` anchor:

  - **`verifyIntegrity` — phantom boundary guard** (`packages/compiler/src/index.ts`): Added an early exit when `bg.entries.size === 0` so that projects with no trust anchors (e.g. a freshly migrated Next.js / vinext app) no longer throw `[Zintl Integrity Error]` for strings extracted by the aggressive stitching engine. When anchors do exist, tightened `isReachable` to check actual reachability from an entry point via `getStaticDependencyTree` instead of mere membership in `bg.nodes`, so phantom boundaries that live outside the anchor dependency chain are silently skipped rather than integrity-checked.

  - **`AssetManager` — phantom asset write guard** (`packages/compiler/src/managers/AssetManager.ts`): Extended `isAssetUsed()` with a boundary graph anchor check that fires only when real Vite module-graph information is available. If the Vite dep graph is populated but `bg.entries.size === 0`, the asset is classified as a phantom and `syncSingleAsset()` returns early without writing any localized output file. In isolated mode (unit tests, programmatic API usage without a Vite instance) the dep graph is empty so the original "assume used" fallback is preserved, keeping all existing asset tests passing.

- a64c32c: Fixed React HMR support, nested entry point reachability checks, and documented the synchronous catalog injection behavior:

  - Corrected boundary graph reachability traversal (`isReachable`) to resolve file paths against target nodes, fixing HMR invalidation failures for nested/bootstrap anchors.
  - Documented the framework-agnostic Synchronous HMR Catalog Injection in `SPEC/ZHMR.md` which leverages Vite's execution order to update the active translation store before component re-renders, rendering manual store subscriptions obsolete.

- 0bd00a8: Fix evaluation of dynamic attributes, tag replacement, and boundary resolution in JSX/SFC compilation:

  - **Export and Import Boundary Resolution**:
    - In `@zintl/extractor`: Maps default and named exports of components to their precise function-level boundary IDs (e.g., `src/App:App` instead of the file boundary `src/App`) in the program visitor.
    - In `@zintl/compiler`: Resolves static import bindings to their precise exported function-level boundary IDs when walking the dependency graph in `intent-utils.ts`, and adds file-level fallback resolution to ownership mapping checks.
  - **Dynamic JSX Attribute Evaluation**: Serializes `_tags` for JSX components as raw JavaScript array literals rather than JSON strings, allowing local scope variables (like imported assets) to be correctly evaluated at runtime.
  - **JSX to HTML Attribute Mapping**: Automatically maps `className` to `class`, and JSX attribute expressions like `src={logo}` to template literal interpolations `src="${logo}"` for elements inside translated templates.
  - **Self-Closing Tag Placeholders**: Extends the runtime key resolver and compile-time baking to support self-closing tags (both `<tag/>` and `<tag />`) when replacing translatable element placeholders.

- 7dd0bfb: Fix HMR script injection for Vue and Svelte SFC components. The compiler now detects the closing `</script>` tag in single-file components and embeds the HMR acceptance code block inside it instead of appending it raw at the end of the file, preventing template syntax compilation errors.

  Additionally, Zintl now injects a dynamic boundary HMR revision token comment in development mode for transformed components. This forces SFC compilers (like Svelte) to generate a modified signature upon catalog invalidation, prompting Svelte's HMR proxy to correctly swap and re-render component instances when translation catalogs change.

- 372448e: Fixed HMR updates for shared and lazy components by resolving entry manager chunks through boundary graph reachability traversal:

  - Updated `getAffectedChunks` to map safe/sanitized boundary IDs back to their physical files.
  - Performed depth-first reachability search to correctly track and invalidate entry managers for any component containing translations.

- f7ee691: Fix compiler caching of boundary environment registrations in SSR setups. Boundaries are now tracked and added to `ssrBoundaries` or `clientBoundaries` on every transform call, bypassing the compile-time AST observation cache. This prevents false-positive "server-only" HMR reload events during client-side hydration.
- a9942b8: Shared server-side AsyncLocalStorage and registry store context on globalThis to prevent request context leaks and hydration mismatches across RSC and SSR environments:

  - Shared request-scoped `storeStorage` (AsyncLocalStorage), `globalRegistry`, `defaultInstance`, and `currentInstance` on `globalThis` in the runtime compiler store to bridge the RSC and SSR execution scopes on the server.
  - Restored standard Vite HMR catalog hot updates by reverting the experimental full-reload trigger for catalog updates.
  - Improved the missing key warn log in translation resolver to print the target boundary ID (`targetBId`) instead of the manager ID.

- 8f51ff6: Added configuration-driven SSR/RSC request isolation support for virtual entry points, zero-config framework auto-detection, and robust URL parsing:

  - Added configuration properties `ssrEntryTargets`, `ssrWrapDefault`, and `ssrWrapExports` to `ZintlOptions` to support generic wrapping of entry points with `runInRequestScope`.
  - Added zero-config auto-detection and defaulting of SSR options (`ssrEntryTargets`, `ssrWrapDefault`, `ssrWrapExports`) for the `nextjs` target (e.g. Next.js / Vinext entries) when using the default target configuration.
  - Robustly extracted the locale from incoming request URLs containing protocols, hostnames, query parameters, or hashes during request-scoped store initialization in `runInRequestScope`.
  - Allowed transformation and request isolation wrapping on registered virtual entry targets (such as `virtual:vinext-rsc-entry` and `virtual:vinext-server-entry`) by bypassing extension and virtual module early returns in the compiler transform process.
  - Updated `zintl` Vite plugin config and transform hooks to forward the new parameters and allow processing of virtual module paths matching `ssrEntryTargets`.

- a6aabcf: Introduce **Virtual Assets Mode** (zero-disk asset reference compilation) to allow building and resolving localized static translation assets purely in memory:

  - **Virtual Assets Configuration**: Added the `virtualAssets?: boolean` option to compiler settings to bypass writing target files to the local filesystem during compilation.
  - **In-Memory Translation Registry**: Integrated localized catalog generation directly with the translation Hive, dynamically retrieving and fuzzy-matching translations virtualized in memory.
  - **Vite/Rollup Asset Emission**: Configured the plugin hooks to map target asset imports to virtual modules (`\0virtual:zintl/asset/...`), emitting optimized and hashed static assets directly via Rollup's `this.emitFile()` API.
  - **Support for raw text and binary loaders**: Supports loading virtualized text and Markdown files under standard and `?raw` loader streams, exporting translated strings as JS modules.

- Updated dependencies [85504fe]
- Updated dependencies [0bd00a8]
  - @zintl/extractor@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- 365d1d2: Fixed boundary resolution and dependency reachability for exported bindings and entry point content modules.

  - Registered candidate boundaries defined in `exportedBoundaries` (e.g. `src/main:createApp`) into the compiler's boundary graph, ensuring that static reachability traversal chains are not broken by named exports.
  - Expanded entry-point content catalog generation (for target locales like `ar`, `es`, `zh`) to always inline and collect all statically reachable boundaries, aligning their structure with the manager's source locale catalog.

- a6ab4f6: Fixed SFC extension normalization in chunk and metadata resolution. Standardized metadata lookup in `getMeta` to resolve `.vue` and `.svelte` files and aligned internal path normalization to only strip JS/TS source extensions (preserving Vue/Svelte extensions), preventing empty catalogs for SFC-level anchors.
- 365d1d2: Fix production SSR client hydration mismatch and Vue SFC multiplex caching:

  - Virtualize Vue and Svelte SFC paths by locale (e.g. `HelloWorld.zintl-ar.vue`) in `resolveIdHook` and `loadHook` to prevent descriptor caching collision in the SFC compilers.
  - Normalize localized virtual SFC paths back to clean original paths in `packages/compiler/src/managers/IOManager.ts`.
  - Allow relative imports within virtualized `.zintl-` SFCs to propagate their locale and get virtualized rather than returning raw clean paths immediately.
  - Skip processing Vue and Svelte virtual sub-requests in `loadHook` and `transformHook` to prevent overriding pre-compiled blocks with raw template blocks.
  - Trim catalog key matching and variable mustache lookups with padding preservation in the compiler pipeline to ensure translations match and preserve leading/trailing whitespace.

- Updated external dependencies:
  - @formatjs/icu-messageformat-parser@^3.5.10
  - @types/node@^24.12.4
  - magic-string@^0.30.21
  - typescript@^5.9.3
- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.4

## 0.1.0-alpha.3

### Minor Changes

- 776aca8: Introduce Single File Component (SFC) extraction/transformation for Vue and Svelte, automatic target resolution, and performance optimizations:
  - **SFC Extraction Support**: Added support for `.vue` and `.svelte` templates and scripts in `@zintl/extractor`. Implemented script block slicing, tag stripping, and position/offset translation for variables, transforms, and locations to map them correctly back to the original source file.
  - **Vue & Svelte Target Presets**: Expanded Target Presets to include comprehensive configurations for Vue and Svelte elements (e.g., translatable attributes like `alt`, `placeholder`, `aria-label`).
  - **Dynamic HTML & Attribute Wrapping**: Added support for SFC-aware rewriting in `@zintl/compiler`. HTML text nodes with dynamic nested tags are automatically wrapped in framework-specific logic (`<span v-html="...">` for Vue, `{@html ...}` for Svelte), and normal text interpolations map to `{{ ... }}` or `{ ... }`. HTML attributes are transformed into reactive bindings (`:attr="..."` or `attr={...}`).
  - **Automatic Target Detection**: Added an `auto` option to the plugin targets. It dynamically queries the project `package.json` dependencies and Vite plugin configurations to auto-configure appropriate extraction targets.
  - **Compiler Flush Performance Recovery**: Optimized the compiler's warm-path flush latency to resolve benchmark regression:
    - Cached the reachable graph nodes in `ZintlCompiler` (`reachableCache`) to avoid repetitive DFS traversals per locale/boundary.
    - Implemented string comparison caching (`lastManifestContent`) for metadata manifests in `MessageManager` to bypass redundant disk writes/reads.
    - Bypassed empty synchronization tasks for assets and HTML projections when there are no updates.
    - Added on-disk verification caching (`confirmedOnDisk`) for catalogs and schemas to avoid multiple expensive `fs.exists` checks on subsequent rebuilds.
  - **Vite Transform Query Safety**: Configured the transform hook in the Vite plugin to skip transforming modules containing query parameters unless they are explicitly tagged with `zintl-multiplex=`, avoiding conflicts with non-JS file assets.
  - **ICU Baker Warnings**: Refined ICU message checking warnings to bypass mustache expressions (`{{ ... }}`) and focus warnings only on actual syntax errors.

### Patch Changes

- 18a7166: Bypassed code transformations and catalog generation/pruning for non-zintlized files and projects:

  - **Bypass Transformations for Non-Zintlized Projects**: Updated the compiler transform pipeline to check for the presence of Zintl entry points/anchors in the project, completely skipping AST transforms and manager injection for projects with zero active entry points (like the `vanilla-ssr` example).
  - **Conditional Vitest Testing Support**: Allowed unit tests checking isolated transforms to continue running in Vitest by identifying test environment file contexts and selectively bypassing the anchor-check.
  - **Dynamic Catalog Restriction**: Updated the catalog manager to skip syncing and pruning boundary catalogs when zero active entry points exist.
  - **Test Coverage**: Added dedicated unit test coverage verifying that non-zintlized source files with UI sinks remain untransformed when no Zintl entry points are present.

- 18a7166: Added support for inline SVG elements during HTML/JSX parsing and resolved fanned routing redirect intercepts in development mode:

  - **SVG Phrasing Elements Support**: Added common SVG child tags (`use`, `path`, `circle`, `rect`, `g`, etc.) to the list of inline phrasing tags. This prevents HTML/JSX text stitching from partitioning at unrecognized sub-tags, eliminating unmatched closing tag validation errors and schema warnings during catalog compilation.
  - **Fanned Routing Support in Dev Mode**: Updated the Vite development index HTML interception logic to inspect both the filesystem path and request path. This prevents custom SSR development servers from rendering empty redirect shells when navigating fanned localized routes.
  - **Request-Scoped SSR Compilation**: Restricted contextual anchor locale baking in the compiler transform when performing server-side builds. This ensures that multi-locale Express/custom SSR servers can generate request-scoped translations dynamically.

- 18a7166: Added support for Server-Side Rendering (SSR) request context isolation and automatic client-side locale inheritance:

  - **SSR Request Scope Isolation**: Integrated compile-time wrapping of the server entry point's exported `render` function inside `runInRequestScope` to prevent request state pollution.
  - **Client Locale Inheritance**: Added client-side oracle mechanism to automatically read and hydrate locale from `document.documentElement.lang`.
  - **Sequential Runtime Builds**: Updated build commands for packaging compiler runtime targets sequentially, avoiding shared chunk collision in virtual imports.
  - **Idempotency Guard**: Added protection in compiler transform to prevent double-wrapping render exports if transformed multiple times during build execution.
  - **Redirect Loop Resolution**: Added path check guards in the client-side redirect script to prevent infinite redirect loops on fanned locale endpoints.
  - **SSR appType Support**: Bypassed DevServer HTML-interception middleware when Vite configuration specifies `appType: "custom"`, allowing Express/custom SSR servers to manage routing and server-side redirection cleanly.

- 776aca8: Fix HTML catalog generation pollution in SFC templates, ignore only-variable text nodes, and optimize translation loader generation:

  - **SFC Catalog and Schema Sanitation**: Prevent `.vue` and `.svelte` files from being incorrectly identified as HTML document projections. This stops the creation of schema files and catalog files containing page-level settings (like `dir`) for SFCs.
  - **Variable-Only Text Node Omission**: Ignore text nodes inside Vue/Svelte SFC templates that only contain variables (e.g. `{{ l.name }}`), avoiding empty translation key generation (`"{var0}"`).
  - **Kingdom-Based Loader Optimization**: Optimize the compilation rewrite of the `zintl` macro. If a boundary manager (and all of its child boundaries/colony files) does not contain any translatable messages or asset dependencies, it is omitted from loader registration to minimize runtime initialization overhead.

- Updated dependencies [776aca8]
- Updated dependencies [18a7166]
- Updated dependencies [776aca8]
  - @zintl/extractor@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Introduce universal target presets, configurable assets mapping, and testing suites:

  - **Target Preset Customization**: Added framework target presets (`react`, `vanilla`, `html`) and a Target DSL in the extractor, allowing developers to configure translatable attributes, sinks, and object property targets.
  - **Universal Asset Targets (`assetsTarget`)**: Added support in the compiler for glob-based asset routing configurations, supporting strategy overrides (such as binary pass-through, text pass-through, frontmatter) and custom strategy callbacks.
  - **Catalog Group-by Path Routing**: Grouped asset catalogs by locale and original relative paths to prevent collisions across multiple files sharing identical basenames.
  - **Testing Verification**: Created dedicated unit test suites covering targets preset expansion, Target DSL parsing, resolver caching, extractor targets integration, and custom asset strategy callback execution.
  - **Decoupled Reference Calibration**: Decoupled the benchmark calibration step from extractor implementation, running it as a pure JS mathematical loop to stabilize execution speed measurements and prevent false budget regression alerts.

- Updated dependencies
- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Rebranded the primary Vite plugin package from `@zintl/vite` to `zintl` to serve as the unified main entry point. Updated the compiler import resolution pipelines, extractor AST visitor patterns, configurations, and example imports to resolve and load from `zintl` and `zintl/macro`.

### Patch Changes

- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `@zintl/vite/macro` has been streamlined as a lean, zero-dependency facade.
- be116c3: **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🟢 1 benchmark(s) improved (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                         | Baseline | New Run                        | Calibrated Delta | Status    |
  | :-------------------------------- | :------- | :----------------------------- | :--------------- | :-------- |
  | Colony HMR Latency (Manager Sync) | 415.9 µs | 391.0 µs (385.2 µs calibrated) | -7.38%           | 🚀 Faster |

### Patch Changes

- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.0

## 0.0.3

### Patch Changes

- be116c3: **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🔴 1 benchmark(s) regressed (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                         | Baseline  | New Run                          | Calibrated Delta | Status       |
  | :-------------------------------- | :-------- | :------------------------------- | :--------------- | :----------- |
  | Extractor Baseline (Full Project) | 1010.9 µs | 1064.4 µs (1075.7 µs calibrated) | +6.41%           | ⚠️ Regressed |

- Updated dependencies [d2d7d9b]
  - @zintl/extractor@0.0.3

## 0.0.2

### Patch Changes

- Optimize compiler pipelines to handle collapsed phrasing tag mappings:
  - **Deduplicated Pipeline Support**: Propagates deduplicated tagMaps through the observation, rewrite, and baking pipelines to align with normalized phrasing tag configurations.
- Updated dependencies
  - @zintl/extractor@0.0.2

## 0.0.1

### Patch Changes

- Fix and optimize compiler HMR, variable shadowing, and generalized page fanning:

  - **HMR Optimization**: Streamlined file caching and fanning checks in the transform pipeline to avoid redundant physical reads during normal dev/HMR fanning, lowering HMR warm-path latency to under `0.002ms`.
  - **Generalized HTML Page Fanning**: Removed hardcoded `index.html` fanned-out catalog generation bounds, fully supporting arbitrary HTML subpage fanning (e.g. `about.html`) with correct `lang`/`dir` metadata.
  - **Variable Shadowing Resolution**: Renamed overlapping `meta` definitions in the HTML projection engine to prevent silent `TypeError`s, fully restoring `deltas` and `rtl` switcher scripts.

- Updated dependencies
  - @zintl/extractor@0.0.1
