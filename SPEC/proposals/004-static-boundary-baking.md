# Zintl Proposal 004: Cross-Boundary Macro Baking

## Overview

Zintl's "Zero-Runtime" promise relies on "Macro Baking"—replacing `t("key")` calls with static string literals during the transformation phase. Currently, this only works reliably in the specific file that calls `zintl()`. Static dependencies (boundaries) reachable from an entry point fail to bake their strings because they lack "Baking Context" aware of the current anchor locale.

## Current Deficiencies (The "Baseline of Shame")

Our integration proofs (`modular-flows.test.ts`) have confirmed the following:

1.  **Stale Macros**: In the `STATIC` flow, the `ui.ts` boundary still contains `t("66b689c1")` in its output.
2.  **Redundant Runtime Calls**: Because baking failed, the runtime must dynamically resolve the key at execution time, even though the source locale is already known at build time.
3.  **Isolation Paradox**: Static dependencies are "Primal" in logic but "Modular" in their failure to share the build-time locale context of their Entry Point.

## Proposed Architecture

### 1. Persistent Baking Context

The compiler must maintain a "Baking Registry" that maps every boundary ID to its intended anchor locale(s), derived from the Entry Point's `zintl(locale)` calls.

### 2. Contextual Transformation

When `transform(code, id)` is called for a module:

1.  **Locate Root**: Identify the Entry Point(s) that statically import this module.
2.  **Inherit Locale**: If the Entry Point defines a static anchor (e.g., `zintl("en")`), that `sourceLocale` is passed into the transformation context for the child.
3.  **Force Baking**: The macro expansion phase will now use this inherited context to replace `t()` calls with literals, even in modules that do not themselves contain a `zintl()` call.

### 3. Multi-Anchor Conflict Resolution

If a static boundary is shared between two entries with _different_ static anchors, baking must be gracefully disabled for that specific module (falling back to runtime resolution) to prevent "Locale Bleed."

## Implementation Details

### Compiler Flow Update

We will modify the `ZintlCompiler.transform` to check the `chunkGraph` before processing macros:

```typescript
const anchorLocale = this.findStaticAnchorForBoundary(fileBoundaryId);

if (anchorLocale) {
  // Bake all t() calls using the strings from anchorLocale
  ms = this.applyMacroBaking(ms, anchorLocale, fileBoundaryId);
}
```

### Static Anchor Detection

```typescript
private findStaticAnchorForBoundary(bId: string): string | null {
   const chunk = this.findChunkForBoundary(bId);
   if (chunk?.type === 'entry') {
      // The Entry Point's anchor locale is the target for baking
      return this.getStaticAnchorForEntry(chunk.entrySources[0]);
   }
   return null;
}
```

## Success Metrics

- **Proof Alignment**: The `modular-flows.test.ts` baseline for `expectedUI` will clearly show `document.body.innerHTML = "Welcome";` instead of the `t()` call.
- **Performance**: Zero runtime overhead for internationalized strings in statically reachable SPA components.
- **Consistency**: All modules in a static tree will share a unified, build-time optimized locale state.
