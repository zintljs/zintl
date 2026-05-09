# Proposal 012: Content-Aware & Tree-Shakable Registry Architecture

**Author**: Antigravity (Bakalau Spirit)
**Status**: High-Path Blueprint
**Related Baseline**: [Baseline of Shame 4.0](file:/SPEC/backlog/012-world-class-meditations.md)

## 1. Executive Summary

The current Zintl architecture, while decentralized, is still limited by **Path-Based Identity** (fragility), **Global Registry State** (concurrency races), and **Side-Effectful Managers** (bundle bloat). This proposal outlines the transition to a high-scale architecture that treats Identity as Content and Context as Scoped.

---

## 2. Problem Solutions (The Architectural Fixes)

### 2.1. Content-Based Identity (Fixing Refactor Amnesia)

- **Current**: `BoundaryID` is based on the file's relative path.
- **Proposal**: Transition to **Content-Hash IDs**. The compiler should compute a stable hash of the translatable messages within a module.
- **Impact**: Moving a file (`old/comp.ts` -> `new/comp.ts`) will NO LONGER change its `BoundaryID`, as the content hash remains identical. Translation history is preserved across refactors.

### 2.2. Contextual Proxying (Fixing the Island Paradox)

- **Current**: Components import a global `t` which uses a "light switch" active instance.
- **Proposal**: Implement **Compiler-Driven Scoping**. The transform should automatically rewrite `t(key)` to `ctx.t(key)` if a scoped instance is detected in the module root, OR Transition to a **Context Hook** architecture for modern frameworks (React/Vue/Svelte).
- **Impact**: Multi-island apps can render simultaneously without cross-pollinating locales.

### 2.3. Side-Effect-Free Managers (Fixing the Tree-Shaking Wall)

- **Current**: Managers use `registerZintlLoader(id, loader)` via side-effect.
- **Proposal**: Virtual modules for managers should export a **Static Catalog Mapping** instead of calling a registry function.
- **Implementation**:
  ```typescript
  // virtual:zintl/manager/A
  export default { id: "a_content_hash", loader: () => import("./ar.json") };
  ```
- **Impact**: The bundler can now tree-shake the entire manager if the module is unused, and can tree-shake individual locale branches if they are not reachable.

### 2.4. Translation Suspense (Fixing the Hydration Void)

- **Current**: `t()` returns an empty string if the catalog is loading.
- **Proposal**: `t()` should support a **Sync-to-Async Handshake**. If the catalog is loading, `t()` returns a stable proxy or triggers a "Handshake Promise" that the hydration engine can wait for.
- **Impact**: Zero "Empty-String Flashes" during slow network hydration.

---

## 3. Verification Blueprint (Nightmare Proofs)

To verify the success of this refactor, the following "World-Class" medals must be achieved:

1.  **Meditation 10 (Amnesia)**: `v1` and `v2` snapshots must show the **exact same ID** in their `registerZintlLoader` calls.
2.  **Meditation 11 (Bloat)**: The final bundle of `main.ts` must NOT contain strings from `utils.ts` if only a constant is imported.
3.  **Meditation 9 (Island)**: Two islands must be able to resolve different locales in the same render cycle.

---

**Mantra**: _Content is Identity. Scopes are Shields. Data is Shakable._
