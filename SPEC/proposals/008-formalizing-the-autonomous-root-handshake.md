# Proposal 008: Formalizing the Autonomous Root Handshake

## Context

Salvation 4.5 introduced the **Autonomous Root Architecture**, consolidating multiple boundaries into single ownership chunks (Managers). However, the implementation of "Literal Baking" and "Runtime Resolution" still relies on legacy flattened lookups, causing regressions in production baking and hydration flashes.

## Proposed Logic Transformations

### 1. Scoped Baking (Compiler)

The current baking logic in `ZintlCompiler.transform` performs a global lookup on the catalog object. This fails because the catalog returned for a chunk is a mapping of `Record<stableBoundaryId, Messages>`.

**Change**:
Update `transform` to resolve the current file's stable identity and access its specific sub-catalog.

```typescript
const stableId = this.getBoundaryId(fileBoundaryId);
const catalog = fullCatalog[stableId];
const translation = catalog ? catalog[msgId] : undefined;
```

### 2. Handshake Determinism (Runtime)

The `isMulti` heuristic in `I18nStore` is "surgical but tight." We should formalize the contract between the **Smart Manager** and the **Store**.

**Change**:
Smart Managers should always return a `Record<boundaryId, Catalog>` (Multi-Boundary mapping) regardless of whether they contain one or many boundaries. This eliminates the need for the `Object.values().some(...)` heuristic.

### 3. Identity Normalization

We must enforce that `msgId` (the SHA-1 hash) is the primary key for all lookups in the built bundle. The `t("text")` macro must always be transformed to `t("id")` by the extractor/compiler pipeline to ensure character-perfect matches in production.

## Expected System Proofs

Once implemented, the following should hold true:

- **Zero-Runtime Baking**: Literal strings in RSC-mode components are replaced by their translated values with 0ms overhead.
- **Deterministic Hydration**: The `loadI18nInstance` handshake correctly maps exactly the reachable boundaries for the current entry point.
- **Ghost-Free Bundles**: Empty managers for boundaries without strings are never imported.
