# Zintl Proposal 005: Ghost Boundary Suppression

## Overview

Currently, Zintl overarchingly injects translation managers and loader registration logic into any module touched by an `import "zintl"` marker, even if that module contains zero translatable strings. This leads to "Ghost Boundaries"—polluted modules that carry redundant logic and, in some modular SPA flows, cause runtime crashes due to missing imports.

## Current Deficiencies (The "Baseline of Shame")

Our integration proofs (`modular-flows.test.ts`) have confirmed the following:

1.  **Ghost Injection**: An empty module (`ghost.ts`) with no strings still receives a `_zintl_mgr_` and a call to `loadI18nInstance`.
2.  **The Ghost Crash**: In side-effect modules, the compiler injects the loader call but fails to add the required `loadI18nInstance` import, leading to a `ReferenceError` at runtime.
3.  **Graph Bloat**: The `BoundaryGraph` is unnecessarily cluttered with "Dead Nodes" that contribute no translations but increase traversal and memory overhead.

## Proposed Architecture

### 1. Weight-Based Boundary Validation

We will introduce a "Weighted" check during the graph construction phase. A boundary is only considered "Active" if:

- It possesses at least one extraction result (message).
- OR It statically imports at least one other Active boundary.

### 2. Primal Suppression

If a boundary is "Dead" (Zero Weight), the `transform()` phase will completely suppress all Zintl-specific logic injection for that file.

- **No Manager**: No `_zintl_mgr_` is generated.
- **No Handshake**: No `loadI18nInstance` or `_zintl_mgr` registration happens.
- **Source Preserve**: The module output remains identical to the input (except for the potential baking of shared entries if applicable).

### 3. Smart Dependency Pruning

The `ChunkGraph` will be updated to prune "Dead" boundaries before manifest generation, ensuring that translation catalogs are never generated for empty modules.

## Implementation Details

### Active Boundary Detection

We will add a recursive weight check to the `ZintlCompiler`:

```typescript
private isBoundaryActive(bId: string, visited = new Set<string>()): boolean {
  if (visited.has(bId)) return false;
  visited.add(bId);

  // Payload check
  if (this.getMessages(bId).length > 0) return true;

  // Static child check (Recursive)
  const node = this.boundaryGraph?.nodes.get(bId);
  return node?.deps.some(dep => !dep.dynamic && this.isBoundaryActive(dep.id, visited)) ?? false;
}
```

### Suppression in Transform

```typescript
if (!this.isBoundaryActive(fileBoundaryId)) {
  // Suppress everything except macro baking
  return transformSuppressManagers(code);
}
```

## Success Metrics

- **Proof Alignment**: The `should suppress injection for empty ghost boundaries` test will prove that `ghostCode === ghostSource` (perfectly clean output).
- **Stability**: Eliminates the `ReferenceError` crashes associated with side-effect modular imports.
- **Build Speed**: Reduced catalog generation overhead by ignoring translation-less modules.
