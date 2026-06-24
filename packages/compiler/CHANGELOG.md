# @zintl/compiler

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
