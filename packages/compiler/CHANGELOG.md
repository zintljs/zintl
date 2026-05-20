# @zintl/compiler

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
