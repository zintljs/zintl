# Zintl Proposal 003: Centralized Manager Registry

## Overview

Zintl's current modular architecture suffers from "Fragmented Handshaking." Static dependencies are incorrectly inlining their own managers and runtime logic, while Entry Points remain hollow and often fail to import the runtime functions they attempt to call. This proposal shifts Zintl to an **Entry-Dominant** model where static modules remain **Primal** (logic-less) and the Entry Point manages a **Consolidated Registry**.

## Current Deficiencies (The "Baseline of Shame")

Our integration proofs (`modular-flows.test.ts`) have confirmed the following:

1.  **Redundant Inlining**: Static boundaries (like `ui.ts`) inline a full `_zintl_mgr_` and call `loadI18nInstance` despite being statically reachable by an Entry.
2.  **Hollow Entries**: Entry Points (like `main.ts`) have empty manager structures even if their children possess messages.
3.  **Broken Imports**: The compiler injects calls to `loadI18nInstance` in the entry but fails to inject the corresponding named import in the module head.

## Proposed Architecture

### 1. Primal Static Dependencies

Modules that are statically reachable from an Entry Point (and not shared across separate entry chunks) will be treated as **Primal**.

- **No Manager**: The module's `_zintl_mgr_` is eliminated.
- **No Handshake**: The call to `loadI18nInstance` is removed.
- **Pure Payload**: The module only contains its application logic (and eventually baked static strings).

### 2. Consolidated Entry Registry

The Entry Point assumes total responsibility for the locale state of its static dependency tree.

- **Aggregate Loader**: The Entry's `_zintl_mgr_` will now contain a mapping of all boundary IDs in its static tree.
- **Unified Switch**: The `switch(locale)` logic in the Entry Point will consolidate imports for all statically reachable chunks.

### 3. Robust Head Injection

Whenever a module (Entry or Boundary) requires `loadI18nInstance` or other runtime functions, the compiler must:

- **Scan Exports**: Check if the function is already imported from `zintl`.
- **Merge Imports**: If `import "zintl"` exists, transform it into `import { loadI18nInstance } from "zintl"`.
- **De-duplicate**: Ensure no redundant imports are added if multiple transformations trigger injections.

## Implementation Details

### Compiler Algorithm Adjustment

The `computeTranslationChunks` logic will be updated to flag boundaries as `isPrimal: true` if they belong to an `entry` chunk but are not the root of that chunk.

During the `transform()` phase:

```typescript
if (this.isPrimalBoundary(fileBoundaryId)) {
  // Only handle macro baking, skip Manager/Loader injection entirely.
  return transformBakingOnly(code);
}
```

### Entry Consolidation Logic

```typescript
// In the Entry Point's generated manager
const _zintl_mgr_src_main = (locale) => {
  switch (locale) {
    case "en":
      // Consolidate keys from ALL static children
      return { ...ownKeys, ...uiKeys, ...headerKeys };
    case "ar":
      // Consolidate dynamic catalog imports
      return Promise.all([
        import("virtual:zintl/content/ar/entry:src/main"),
        import("virtual:zintl/content/ar/entry:src/ui"),
      ]).then((results) => mergeCatalogs(results));
  }
};
```

## Success Metrics

- **Proof Alignment**: The `modular-flows.test.ts` baseline will be updated (sharpened) until it shows exactly zero redundant managers in static modules.
- **Runtime Integrity**: Applications will no longer crash due to missing `loadI18nInstance` imports.
- **Bundle Efficiency**: Dramatic reduction in duplicated boilerplate across modular SPAs.
