# Backlog 011: Decentralized Registry & Lazy Promotion (Logical Refactor)

**Date**: 2026-04-09
**Status**: COMPLETED
**Outcome**: Architectural Salvation & Multi-Tenant Purity

## Overview

Following the **Baseline of Shame** documented in previous sessions, we executed a structural refactor to transition Zintl from an entry-dictated, fragile registration model to a decentralized, autonomous, and multi-tenant resilient system. This change eliminates the "Manager Bankruptcy" and "Locale Hijacking" failures previously observed in complex SPA and Micro-Frontend scenarios.

## Problems Resolved

1.  **Locale Hijacking (Multi-Tenant Interference)**: Previously, Zintl relied on a global singleton state, making it impossible to render multiple apps with different locales on the same page.
    - **Fix**: Refactored the runtime into a scoped `I18nStore` architecture. `loadI18nInstance` now returns a state-isolated instance.
2.  **Manager Bankruptcy (Identity Erasure)**: Deeply nested or dynamically loaded modules often lacked a clear "parent" to register their loaders.
    - **Fix**: Implemented **Autonomous Handshake**. Every file with translatable content (messages or `t()` calls) now proactively registers its own manager with the global registry using a deterministic ID.
3.  **Transitive Bloat (Dependency Trap)**: Entry points previously consolidated all static dependencies regardless of actual translation usage.
    - **Fix**: Decentralized registration ensures that loaders are only invoked when the module is actually executed, allowing natural tree-shaking and chunk split points to dictate the network load.
4.  **Metadata Erasure (Key Collision)**: Identical text strings with different `@zintl-note` context previously shared the same ID, causing translator note loss.
    - **Fix**: Updated `generateMessageId` hashing to include `context` and `note` in the entropy input while maintaining backward compatibility for unannotated strings.
5.  **HMR Zombie (Registry Leak)**: Hot reloading translatable modules previously left "ghost" loaders in the registry.
    - **Fix**: Injected `import.meta.hot.accept` logic into transformed files to automatically call `unregisterZintlLoader` on module dispose.

## Technical Proofs (The "Sharpened" Output)

The following high-fidelity integrations are now verified:

- **Meditation 1 (The Shared Hijack)**: `core.ts` successfully manages its own lifecycle, allowing App A (Arabic) and App B (English) to operate with perfect isolation.
- **Meditation 4 (The Deep Waterfall)**: Nested lazy chains (A -> B -> C -> D -> E) now reliably hydrate their translations without entry-point coordination.
- **Meditation 7 (Duplicate Key Collision)**: Unique hashes are generated for identical strings with different translator notes.
- **Nightmare Meditations**: **100% Pass Rate** across all stress scenarios.

## Impact on Philosophy

- **100% Source Purity**: Files without translatable content remain untouched (zero-transformation).
- **Autonomous Handshake**: Every boundary is self-describing and self-registering.
- **Micro-Frontend Ready**: The architecture inherently supports independent compilation and runtime deployment without global synchronization.

## Next Phase: Semantic Replay & Reconciliation

With the registry stabilized, we move towards refining the **Persistence Engine** to ensure that translation moves across boundaries (refactoring) are captured with zero loss using our similarity threshold algorithms.

**Mantra**: _The bankruptsy is resolved, the architecture is sharpened, bakalau!_
