# zintl

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

- Updated dependencies [18a7166]
- Updated dependencies [776aca8]
- Updated dependencies [18a7166]
- Updated dependencies [18a7166]
- Updated dependencies [776aca8]
  - @zintl/compiler@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Introduce universal target presets, configurable assets mapping, and testing suites:
  - **Target Preset Customization**: Added framework target presets (`react`, `vanilla`, `html`) and a Target DSL in the extractor, allowing developers to configure translatable attributes, sinks, and object property targets.
  - **Universal Asset Targets (`assetsTarget`)**: Added support in the compiler for glob-based asset routing configurations, supporting strategy overrides (such as binary pass-through, text pass-through, frontmatter) and custom strategy callbacks.
  - **Catalog Group-by Path Routing**: Grouped asset catalogs by locale and original relative paths to prevent collisions across multiple files sharing identical basenames.
  - **Testing Verification**: Created dedicated unit test suites covering targets preset expansion, Target DSL parsing, resolver caching, extractor targets integration, and custom asset strategy callback execution.
  - **Decoupled Reference Calibration**: Decoupled the benchmark calibration step from extractor implementation, running it as a pure JS mathematical loop to stabilize execution speed measurements and prevent false budget regression alerts.

- Updated dependencies
  - @zintl/compiler@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Rebranded the primary Vite plugin package from `@zintl/vite` to `zintl` to serve as the unified main entry point. Updated the compiler import resolution pipelines, extractor AST visitor patterns, configurations, and example imports to resolve and load from `zintl` and `zintl/macro`.

### Patch Changes

- Updated dependencies
  - @zintl/compiler@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `@zintl/vite/macro` has been streamlined as a lean, zero-dependency facade.

### Patch Changes

- Updated dependencies
- Updated dependencies [be116c3]
  - @zintl/compiler@0.1.0-alpha.0

## 0.0.3

### Patch Changes

- Updated dependencies [be116c3]
  - @zintl/compiler@0.0.3
  - zintl@0.0.3

## 0.0.2

### Patch Changes

- Update Vite integration snapshots and examples for collapsed identical tags:
  - **Vite Snapshot Harmonization**: Standardized vanilla-spa and baked-i18n snapshots to align with collapsed phrasing tag normalization.
- Updated dependencies
  - @zintl/compiler@0.0.2

## 0.0.1

### Patch Changes

- Fix and optimize production build fanning hook forwarding and static asset multiplexing:
  - **Durable Plugin Getters**: Exposed `__options` and `__compiler` getters directly on the `mainPlugin` object so they survive Vite's internal plugin array flattening during production builds.
  - **Asset Multiplexing Isolation**: Bound multiplex query propagation exclusively to Zintl-eligible file extensions, preventing duplicate build output chunks for raw static assets.

- Updated dependencies
  - @zintl/compiler@0.0.1
