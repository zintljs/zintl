# zintl

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
