# Backlog: Unified Runtime & Loading Architecture

**Status**: ✅ Completed  
**Last Updated**: 2026-04-07  
**Feature Owner**: Antigravity & User

---

## 🎯 Objective

Finalize the transition from a store-centric, static-injection model to a **High-Performance Identity Call Model**. This architecture unifies all `zintl` call sites into a "Smart Loader" system that balances instant rendering with lazy-loading efficiency.

## 🛠️ Key Architectural Decisions

### 1. The "Smart Manager" Pattern

Every translation boundary is now backed by a functional loader (the Manager).

- **Reasoning**: Decouples the runtime from the physical structure of the catalogs. The runtime doesn't need to know if a locale is in the main bundle or a separate chunk; it just requests it.
- **Implementation**: Inlined switches in the generated JS that map locales to either objects (inlined) or `import()` calls (lazy).

### 2. Hybrid Synchronous/Asynchronous Propagation ("Sync Boost")

The runtime is designed to update side-effects (locale state, store) synchronously during the first tick if the data is available.

- **Reasoning**: Prevents "flashing" or empty content during initial application render.
- **Impact**: Static anchors like `zintl("ar")` result in a fully populated Arabic store before the first application frame renders.

### 3. Progressive "Ghost Mode"

English (the source locale) is now purely virtual.

- **Reasoning**: Eliminates redundant English files on disk.
- **Selective Inlining**: The compiler now only inlines the English catalog if it's the active language. If the app starts in Arabic, English becomes a lazy `import()` on a virtual path, keeping the main bundle lean.

### 4. Boundary Consolidation

Shared boundaries at the file-level using pre-scanning.

- **Reasoning**: Avoids fragmented boundary IDs like `src/main:anon` caused by event listeners.
- **Implementation**: Top-level anchors establish a parent ID for the entire module.

## ⚠️ Potential Debt & Risks

- **Injection Logic Fragility**: The compiler currently performs complex code injection using regex/MagicString. Adding support for diverse bundlers or complex AST patterns (like higher-order `zintl` wrappers) may require a full AST-to-Code generation pass in the future.
- **Sync/Async Expectations**: While literal anchors are synchronous, expression-based anchors (`zintl(computed)`) will always be asynchronous. Developers must be educated to `await` those calls before rendering content.
- **Circular Dependencies**: Extensive dependency tracking in the boundary graph could potentially lead to circular virtual module references in extremely complex setups.

---

## 🚀 Future Roadmap

- [ ] **Build Validation**: Introduce a build-time check to ensure all `zintl` calls have been successfully transformed into `loadI18nInstance` calls.
- [ ] **Type Safety Extension**: Enhance the `I18nInstanceConfig` to support strictly typed loader IDs based on extractable boundary names.
- [ ] **Framework Hooks**: Implement a thin React/Vue wrapper that leverages the `subscribe` and synchronous initialization for zero-config SSR support.
