# Proposal 007: Test Suite Normalization (Post-Salvation)

## Context

The Zintl compiler has undergone a massive architectural shift (Salvation 4.0 - 4.5). We moved from a **Self-Registering Boundary** model to an **Autonomous Root Handshake** model. This shift has created a logical discriminant between the current optimized output and the existing test suite (`packages/compiler/src/*.test.ts`).

## Objectives

Normalize the test suite to align with the **Content-Aware Registry 4.5** specifications.

## Proposed Strategy

### 1. Identity Normalization

- **Dev Mode Expectation**: Update ID matching to expect readable paths (e.g. `src/main`) instead of hashes when the compiler is in `isDev` mode.
- **Variable Sanitization**: Verify that JS variable names use `getSafeBoundaryId` (hashes) while the `_bId` parameter and virtual URLs use the readable path.

### 2. Output Verification (The New Baseline)

The transformation output has changed significantly. Tests must now verify:

- **`_mgr` Parameter**: Injected into every `t()` call.
- **`_bId` Parameter**: Injected for scoped lookup, enabling autonomous hydration.
- **Handshake Generation**: `loadI18nInstance` now receives a consolidated mapping of multiple boundaries.

### 3. I18nStore Flattening

- New tests must reflect that `I18nStore` now flattens all catalogs into `catalogs[locale][boundaryId]`.
- Existing tests that expect nested lookup behavior should be updated to verify the flat resolution logic.

### 4. Pruning Logic

- Add integration tests to verify "Ghost Roots" are correctly pruned from the handshake if they contain no active content and have no content-bearing children.

## Warning: Primal Dependencies

Do NOT attempt to revert to manual registration. The system is strictly Entry-Dominant. Any failure in the test suite regarding "Missing Registration" should be fixed by ensuring the Entry Point's handshake correctly includes the missing boundary.

**Mantra**: _Measure the current shame, update the assertions, Bakalau!_
