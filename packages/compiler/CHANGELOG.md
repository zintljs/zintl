# @zintl/compiler

## 0.0.1

### Patch Changes

- Fix and optimize compiler HMR, variable shadowing, and generalized page fanning:
  - **HMR Optimization**: Streamlined file caching and fanning checks in the transform pipeline to avoid redundant physical reads during normal dev/HMR fanning, lowering HMR warm-path latency to under `0.002ms`.
  - **Generalized HTML Page Fanning**: Removed hardcoded `index.html` fanned-out catalog generation bounds, fully supporting arbitrary HTML subpage fanning (e.g. `about.html`) with correct `lang`/`dir` metadata.
  - **Variable Shadowing Resolution**: Renamed overlapping `meta` definitions in the HTML projection engine to prevent silent `TypeError`s, fully restoring `deltas` and `rtl` switcher scripts.

- Updated dependencies
  - @zintl/extractor@0.0.1
