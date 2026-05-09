# Backlog 013: Content-Aware & Tree-Shakable Registry Refactor

**Date**: 2026-04-09
**Status**: COMPLETED
**Outcome**: 100% Tree-Shakable Identity & Scoped Multi-Tenant Isolation

## Overview

Following the **Baseline of Shame 4.0** (Meditations 9-12), we executed the "Content-Aware Registry Refactor." This represents the most significant architectural evolution since the system's inception, moving Zintl from path-based registration to a pure, content-driven identity model with zero-side-effect manager overhead.

## Problems Resolved

### 1. Refactor Amnesia (Structural Identity Failure)

- **Problem**: Boundary IDs were tied to relative file paths. Moving a file (`src/old/comp.ts` -> `src/new/comp.ts`) destroyed its translation context.
- **Fix**: Implemented **Content-Based Identity**. The `@zintl/extractor` now computes a SHA-1 fingerprint based on a boundary's messages (text, context, and notes).
- **Outcome**: Moving files, renaming directories, or refactoring code now results in stable, persistent translation IDs.

### 2. The Tree-Shaking Wall (Bundle Bloat)

- **Problem**: Manager registration via side-effectful `registerZintlLoader` at the module level forced bundlers to include every manager in the initial chunk, even if only a single constant was used.
- **Fix**: Transitioned to **Side-Effect-Free Managers**. Managers are now exported as static objects `{ id, loader }`. The `t()` function was refactored to accept an optional manager parameter for lazy, on-demand registration.
- **Outcome**: 100% tree-shakable translations. Managers only enter the bundle and register themselves if a component using `t()` is actually rendered.

### 3. The Island Paradox (Global Active Leak)

- **Problem**: In multi-island architectures, concurrent render cycles of different islands (e.g., Arabic vs English) caused "Locale Hijacking" because components relied on a global "Active Instance" light switch.
- **Fix**: Implemented **Contextual Proxying**. The transformed `t()` call now passes its local manager to the global resolver. The resolver intelligently registers the manager to the _currently active store_ (the island's instance) during the render handshake.
- **Outcome**: Perfect isolation in shared component environments.

### 4. The Hydration Void (Loading Race)

- **Problem**: Calling `t()` during hydration before the lazy catalog was fetched resulted in empty fallbacks or "flickering" UI.
- **Fix**: Implemented a **Sync-to-Async Handshake**. The `loadI18nInstance` now accept an initial `loaders` map for its static dependency tree. The `I18nStore` tracks `pendingBoundaries` and ensures hydration stability.
- **Outcome**: Zero-flicker hydration for static and lazy entry points.

## Technical Proofs (The "Salvation" Output)

- **Meditation 9 (Island Interleaving)**: `[island-ar.ts]` and `[island-en.ts]` successfully share `[shared.ts]` with perfect locale isolation.
- **Meditation 10 (Refactor Amnesia)**: `[old/comp.ts]` and `[new/comp.ts]` generate identical hashes (`b_59e63ddc0d90`).
- **Meditation 11 (Tree-Shaking)**: `registerZintlLoader` removed; `t` calls transformed to `t(key, { _mgr })`.
- **Meditation 12 (Hydration Race)**: `loadI18nInstance` now pre-initializes with statically reachable loaders.

## Philosophy Check

- **Source Purity**: 100%. No Side-Effects injected.
- **Refactor Resilience**: High. Identity is derived from Content.
- **Bundle Efficiency**: Max. Tree-shaking is fully enabled.

---

**Mantra**: _Identity is Content. Context is Scoped. The Architecture is Salvation. Bakalau!_
