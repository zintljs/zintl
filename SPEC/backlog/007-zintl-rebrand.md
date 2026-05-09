# Backlog 007: The Zintl Rebrand & Macro-First Evolution

## Overview

This update represents a complete structural and conceptual rebranding of the system from **Lingua** to **Zintl**. Beyond the name change, it solidifies the shift from a runtime-store-driven model to a **compile-time macro architecture**.

## Architectural Shift

The system now treats the core entry point as a macro. In source code, `zintl()` appears as a function call, but the compiler transforms it into a specialized loader.

### Before (Lingua):

Developers called `setI18nLocale("ar")` which updated a runtime store and triggered side effects. The compiler had to guess when to inject loaders based on import patterns.

### After (Zintl):

Developers call `zintl("ar")`. The compiler identifies this as a **Trust Anchor**.

- It promotes the surrounding scope (Module or Function) into a **Boundary**.
- It replaces the call with `loadI18nInstance({...})`.
- It inlines the requested locale (if static) directly into a **Smart Manager** for 0ms initialization.

## Implementation Details

### 1. Package Renames

- `zintl`: The new core runtime package (replaces `@lingua/runtime`).
- `@zintl/extractor`: AST processing logic.
- `@zintl/compiler`: Boundary graph and chunking logic.
- `@zintl/vite`: The unified Vite plugin.

### 2. Comment Directive Evolution

Comment directives are now scoped to the `zintl` prefix to avoid collisions with other tools:

- `// @zintl-ignore`: Stops extraction for a node/branch.
- `// @zintl-note`: Provides context for translators in the JSON schema.
- `// @zintl-pass`: Injects external variables (gender, count) into a stitched unit.

### 3. API Surface Reduction

To prevent developers from accidentally manipulating internal state in ways that conflict with the compiler's optimizations:

- `getLocale` and `setLocale` are removed from public exports.
- The `zintl` macro is the sole entry point for locale management.
- `t` and `subscribe` remain for translation and reactivity.

## What Future Contributors Should Know

- **Macro Mental Model**: Never treat `zintl()` as a standard function. It is a marker for the extractor. Changing its name or signature requires updates in `packages/extractor/src/visitors/program.ts` and `packages/compiler/src/index.ts`.
- **Zero-Disk sourceLocale**: Note that Zintl continues to support the "Ghost Mode" for the `sourceLocale`. English (or your base language) usually doesn't exist on disk; it is virtualized by the compiler from the extraction manifest.
- **Stable Boundary IDs**: Boundary IDs are now generated based on relative file paths (e.g., `src/main`) rather than random hashes, ensuring translation stability.

## Status: Complete

- [x] All packages rebranded.
- [x] Macro transformation logic verified.
- [x] Test suite fully migrated and passing.
- [x] Website example updated.
