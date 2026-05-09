# Proposal: Decentralized Registry & Lazy Promotion Architecture

**Author**: Antigravity (Bakalau Spirit)
**Status**: Draft / High-Path Blueprint
**Related Baseline**: [Baseline of Shame 2.0 (Nightmare Meditations)](file:/packages/vite/src/__tests__/nightmare-scenarios.test.ts)

## 1. Executive Summary

The current Zintl architecture follows a "Dictator-Entry" model, where transformation and manager registration only occur if a file explicitly calls `zintl()`. Our recent "Nightmare Meditations" have proved that this leads to **Manager Bankruptcy** for lazy imports and **Locale Hijacking** in multi-entry SPAs.

This proposal outlines the shift to a **Decentralized Registry Model**, where the compiler aggressively promotes dynamic imports into entries and the runtime uses a scoped Handshake to prevent global state collisions.

---

## 2. Problem Statements (The Shame Proofs)

### 2.1. Manager Bankruptcy (The "Ghost" Problem)

In deep lazy chains (`A -> import(B) -> import(C)`), if `B` and `C` do not call `zintl()`, they are currently treated as "Pure Ghosts." They have no manager registration and cannot translate themselves if loaded independently or by a different app.

- **Proof**: `nightmare-scenarios.test.ts > Meditation 4`.

### 2.2. Locale Hijacking (Global Pollution)

Currently, `loadI18nInstance` overwrites `globalThis.__ZINTL_LOCALE__`. In a session with multiple Zintl apps (Micro-frontends), they fight over this single variable.

- **Proof**: `nightmare-scenarios.test.ts > Meditation 1`.

### 2.3. The Static/Lazy Shadow (Timing Race)

When a module is both a static dependency of Entry A and a lazy dependency of Entry B, it loses its manager registration in the lazy branch, causing a failure if Entry A isn't loaded first.

- **Proof**: `nightmare-scenarios.test.ts > Meditation 3`.

### 2.4. The Homeless Parent (Offline Modules)

Modules "above" or "beside" an anchor branch are currently ignored by the graph traversal. Their translations are never extracted into any catalog.

- **Proof**: `deep-scenarios.test.ts > Meditation 5`.

### 2.5. Transitive Bloat (Bundle Poisoning)

The compiler flattens all static dependencies into the root manager, even if those dependencies are purely structural (e.g. importing a type/const from a heavy UI module).

- **Proof**: `deep-scenarios.test.ts > Meditation 6`.

### 2.6. Metadata Erasure (Key Collisions)

Identical keys in different files overwrite each other's metadata (translator notes), leading to loss of context for the translation team.

- **Proof**: `deep-scenarios.test.ts > Meditation 7`.

---

## 3. High-Path Solution

### Phase A: Compiler-Level "Lazy Promotion"

The `ZintlCompiler` must evolve from detection to **Aggressive Promotion**:

1.  **Identify Boundary Roots**: Any file targeted by a dynamic `import()` MUST be treated as a potential `lazy` root by the graph.
2.  **Autonomous Handshake**: Every file with translatable content (messages > 0) MUST receive a manager injection and a `registerZintlLoader` call, even if it has no `zintl()` anchor.
3.  **Stable ID Guarantee**: Ensure that a file's Boundary ID is consistent whether it is loaded statically or lazily.

### Phase C: Granular Dependency Tracking

The compiler must evolve from "Static Flattening" to "Impact-Based Extraction":

1.  **Primal Filtering**: Only extract strings from modules that are actually "Content Providers" for the current entry.
2.  **Key Isolation**: Hashing for keys should include contextual indicators or file paths to prevent Note-Erasure during collisions.
3.  **Active Registry Unloading**: The runtime must support a `unregisterZintlLoader` or "Replacement" signal to prevent HMR Zombie leaks.

---

## 4. Implementation Detailed Blueprint

### Compiler Transformation (Logical Surgery)

```typescript
// Proposed logic for ZintlCompiler.transform
if (isLazyRoot(id) || hasTranslatableContent(result)) {
  // FORCE manager injection even without zintl() call
  ms.prepend(`import _zintl_mgr from "virtual:zintl/manager/none/boundary:${fileBoundaryId}";\n`);
  ms.prepend(`registerZintlLoader("${fileBoundaryId}", _zintl_mgr);\n`);
}
```

### Virtual Module Intelligence

The `virtual:zintl/manager` generator must be updated to automatically detect the "Best Anchor" for a shared module based on the graph reachability, rather than defaulting to "none" for all shared boundaries.

---

## 5. Verification Plan (Proof of Success)

To verify the success of the upcoming refactor, the following "Nightmare" markers must be achieved:

1.  **Meditation 1**: `results["src/core.ts"]` MUST contain a manager registration that is tenant-aware.
2.  **Meditation 4**: Every level of the "Deep Waterfall" (`a.ts` through `e.ts`) MUST have their own `registerZintlLoader` calls.
3.  **Meditation 3**: `shared.ts` MUST be injected with a manager that handles its lazy loading target correctly.

---

**Mantra**: _Stop the ghosting. Promote the lazy. Protect the registry._
