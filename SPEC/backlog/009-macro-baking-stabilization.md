# Backlog Item 009: Macro Baking & Grammar Stabilization

## Status

**Completed** (Foundation for Zero-Runtime I18n)

## Problem

The previous macro transformation pipeline suffered from several instabilities:

1. **Ambiguous Entries**: Implicit entries (markers) like `import "zintljs"` were captured by the extractor but ignored by the compiler, leading to missing translation boundaries in the build.
2. **Anonymous Collisions**: Multiple anonymous functions calling `zintl()` in the same file shared identical boundary IDs (`anon`), causing translation key collisions and graph corruption.
3. **Redundant Rollups**: The compiler's catalog generation logic (`getCatalogForFullModule`) manually re-walked dependencies, ignoring the pre-computed `chunkGraph`. This "Double-Rollup" bug caused shared dependencies to be duplicated into entry catalogs, increasing bundle sizes.
4. **Fragile Grammar**: Code generation for baked inlining was prone to syntax errors and lacked support for contextual (no-argument) `zintl()` calls.

## Solution

We have stabilized the macro baking and grammar pipeline to ensure deterministic, performant internationalization.

- **Zero-Runtime Baking**: Static literals (e.g., `zintl("ar")`) are now fully "baked" at compile-time into optimized ternary trees, removing the `loadI18nInstance` overhead.
- **Marker & Implicit Support**:
  - `import "zintljs"` now acts as an explicit entry marker, ensuring the file is treated as a translation boundary even without dynamic calls.
  - `zintl()` (implicit) initializes the manager context for the active runtime locale without baking specific catalog data.
- **Deterministic Boundary IDs**: Anonymous function IDs are now uniquely identified using line numbers (e.g., `anon_12`), preventing collisions within the same module.
- **Chunk-Aware Resolution**: Catalog generation now strictly iterates over `targetChunk.boundaries`. This aligns output with the `Boundary Graph Algorithm`, ensuring that shared boundaries stay in their own chunks and entries remain lean.

## Changes

- **`packages/compiler/src/index.ts`**:
  - Refined `transform` to support markers and implicit anchors.
  - Simplified `getCatalogForFullModule` to eliminate redundant dependency walking.
  - Added `isEntry` and `getMessages` helpers to the public API.
- **`packages/extractor/src/visitors/program.ts`**:
  - Implemented `ImportDeclaration` visitor to flag `hasZintlMacro` for extraction markers.
  - Updated anonymous ID generation to include line context.
- **`packages/compiler/src/macro/`**:
  - Stabilized `grammar.test.ts`, `boundaries.test.ts`, and `streaming.test.ts`.
  - Aligned test expectations with the 8-character SHA-1 message hashing system.

## Next Steps

- Implement framework-specific Vite/Next.js plugins that leverage the new `isEntry` detection for automatic injection.
- Expand "Ghost Mode" logic to support selective inlining of target locales based on build targets.
- Optimize the `ZintlCompiler` initialization to cache `boundaryGraph` results more aggressively in dev mode.
