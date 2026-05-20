# @zintl/extractor

## 0.1.0-alpha.2

### Patch Changes

- Introduce universal target presets, configurable assets mapping, and testing suites:
  - **Target Preset Customization**: Added framework target presets (`react`, `vanilla`, `html`) and a Target DSL in the extractor, allowing developers to configure translatable attributes, sinks, and object property targets.
  - **Universal Asset Targets (`assetsTarget`)**: Added support in the compiler for glob-based asset routing configurations, supporting strategy overrides (such as binary pass-through, text pass-through, frontmatter) and custom strategy callbacks.
  - **Catalog Group-by Path Routing**: Grouped asset catalogs by locale and original relative paths to prevent collisions across multiple files sharing identical basenames.
  - **Testing Verification**: Created dedicated unit test suites covering targets preset expansion, Target DSL parsing, resolver caching, extractor targets integration, and custom asset strategy callback execution.
  - **Decoupled Reference Calibration**: Decoupled the benchmark calibration step from extractor implementation, running it as a pure JS mathematical loop to stabilize execution speed measurements and prevent false budget regression alerts.

- **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🟢 1 benchmark(s) improved (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                    | Baseline  | New Run                          | Calibrated Delta | Status    |
  | :--------------------------- | :-------- | :------------------------------- | :--------------- | :-------- |
  | Extract Long File (200 keys) | 1574.7 µs | 1618.5 µs (1432.9 µs calibrated) | -9.01%           | 🚀 Faster |

## 0.1.0-alpha.1

### Minor Changes

- Rebranded the primary Vite plugin package from `@zintl/vite` to `zintl` to serve as the unified main entry point. Updated the compiler import resolution pipelines, extractor AST visitor patterns, configurations, and example imports to resolve and load from `zintl` and `zintl/macro`.

## 0.1.0-alpha.0

### Minor Changes

- Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `@zintl/vite/macro` has been streamlined as a lean, zero-dependency facade.

## 0.0.3

### Patch Changes

- d2d7d9b: Optimize HTML and JSX extraction, phrasing-tag normalization, and comment directive handling:
  - **Nested Phrasing Tag Support**: Flawlessly parses and normalizes deeply nested phrasing tags (e.g., `<a>read <code>instructions</code></a>`) without disrupting tag open/close balances or generating malformed outputs.
  - **Transparent Phrasing Directives**: Allows HTML comment directives (`@zintl-note` and `@zintl-pass`) to live inside phrasing tag boundaries without partitioning the translatable string, propagating meta annotations seamlessly to translators.

## 0.0.2

### Patch Changes

- Optimize HTML and JSX extraction and phrasing-tag normalization:
  - **Phrasing Tag Collapsing**: Collapses exactly identical phrasing tag configurations (e.g. identical `<span>` tags) to a single clean base alias, avoiding redundant numbering and duplicate entries in translation catalogs.
  - **Heterogeneous Tag Numbering**: Retains stable numbering (`span1`, `span2`) exclusively for tags that carry different classes, attributes, or IDs to preserve translation safety.

## 0.0.1

### Patch Changes

- Normalize Windows-style CRLF (`\r\n`) line endings to LF (`\n`) at the start of both JS/TS and HTML extraction pipelines. This guarantees platform-independence and prevents range/offset alignment mismatches.
