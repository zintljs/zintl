# Backlog 010: High-Fidelity Scenario-Driven Test Harness

**Date**: 2026-04-09
**Status**: ACTIVE / SYSTEM CORE
**Component**: `packages/vite/src/__tests__/harness.ts`

## Overview

To support the "Madness Meditations" required for Zintl's growth, we established a new integration testing infrastructure. This system moves away from simple unit-line tests toward **Full System Proofs** involving complex multi-module scenarios.

## Architectural Features

### 1. Multi-Module Project Simulation

The `ctx.project()` engine allows developers to define a "mini-filesystem" within a test.

- **Isolation**: Each test runs in a unique `mkdtemp` root.
- **Warmup Phase**: The harness performs a two-pass transformation (Warmup -> Final) to ensure the compiler's `BoundaryGraph` is fully populated before snapshots are taken.

### 2. Snap-to-Target Workflow

We established a TDD evolution pattern where:

1.  Target architecture is manually doctored into `.snap` files.
2.  System failures (diffs) provide the technical debt roadmap.
3.  The compiler is adjusted until it matches the target bytes exactly.

### 3. Semantic Matchers (`zintlMatchers`)

A set of high-level Vitest matchers were built to verify foundational i18n logic without brittle string-mucking:

- `toRegisterManager`: Verifies per-module manager registration.
- `toSyncLocale`: Verifies the entry-point global handshake.
- `toImportFromZintl`: Verifies selective, clean runtime imports.

## Impact on Development

This harness enabled the discovery of the **Baseline of Shame 2.0 & 3.0** (Nightmare Meditations). It allows us to simulate:

- Circular dependencies.
- Multi-entry registry collisions.
- Static/Lazy boundary shadowing.

---

**Philosophy**: _We do not accept "maybe it works." Tests are System Proofs._
