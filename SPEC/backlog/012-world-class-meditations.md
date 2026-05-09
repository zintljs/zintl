# Backlog 012: World-Class Meditations (Baseline of Shame 4.0)

**Date**: 2026-04-09
**Status**: RESOLVED (See Backlog 013)
**Baseline Proofs**: `packages/vite/src/__tests__/world-class-scenarios.test.ts`

## Overview

Following the Decentralized Registry refactor, we entered the **Baseline of Shame 4.0** to test Zintl against extreme world-class architectural requirements: Concurrency, Build-time Optimization, and Refactor Stability.

## The Findings (Architectural Limits)

### 1. The Global Active Race (Island Paradox)

- **Problem**: Deeply nested components importing `t` from `zintl` (global) still rely on the "Active Instance" light switch.
- **Impact**: In multi-island apps, Island A can accidentally render with Island B's locale if their render cycles interleave.
- **Proof**: `Meditation 9`.

### 2. Structural Identity Amnesia

- **Problem**: Boundary IDs are tied to relative file paths.
- **Impact**: Moving a file (`src/old/A.ts` -> `src/new/A.ts`) destroys its translation context, requiring re-translation.
- **Proof**: `Meditation 10`.

### 3. The Tree-Shaking Wall

- **Problem**: Manager registration via side-effectful `registerZintlLoader` prevents bundlers from tree-shaking unused strings.
- **Impact**: Importing a single constant from a heavy translation module pulls the entire 1000-message manager into the bundle.
- **Proof**: `Meditation 11`.

### 4. The Hydration Void

- **Problem**: Calling `t()` before a lazy loader resolves returns an empty fallback.
- **Impact**: Users see "broken" or "empty" text during the hydration gap, even if the catalog is already in the network pipe.
- **Proof**: `Meditation 12`.

---

**Vision**: _Identity should be Content. Context should be Scoped. Registry should be Tree-Shakable._
