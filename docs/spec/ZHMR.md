# Zintl HMR Specification (ZHMR)

**Version**: 1.0  
**Status**: Active

---

## §1 — The HMR Philosophy

Hot Module Replacement in Zintl is not a simple file reload. It is a **Surgical Invalidation** of the internationalization dependency graph. The goal is to update translations without a full page refresh whenever possible, while maintaining strict consistency between the compiler's world state and the runtime's hydration.

---

## §2 — The Invalidation Pipeline

When a file changes, the system executes a multi-stage invalidation dance:

### §2.1 — Stage 1: Compiler Synchronization

- **Re-Observation**: The compiler re-scans the changed file for anchors, sinks, and dependencies.
- **State Flush**: The `BoundaryGraph` and `ChunkGraph` are rebuilt to reflect any structural shifts (e.g., a file moving from a Kingdom to a Colony).
- **Manifest Update**: The internal translation manifest is updated, and physical JSON catalogs on disk are synced.

### §2.2 — Stage 2: Vite Hook Handshake

The `handleHotUpdate` hook in the Vite plugin receives the changed file and queries the compiler for **Affected Modules**.

1. **Direct Invalidation**: The changed source module itself is invalidated by Vite.
2. **Affected Chunks**: The compiler returns a list of virtual IDs (e.g., `virtual:zintl/content/...`, `virtual:zintl/manager/...`) that are impacted by the change.
3. **Entry Point Cascading**: Crucially, the compiler identifies all **Entry Points** (e.g., `main.ts`) that depend on the changed boundary. Because shared or lazy component boundaries are isolated into their own shared/lazy chunks, their boundaries won't match direct entry chunk boundaries. The compiler solves this by mapping the boundary ID back to its physical file path/ID and traversing the `BoundaryGraph` via reachability checks to trace back to all importing entry points, ensuring their virtual managers are invalidated.
4. **Timestamp Propagation**: The Vite plugin sets the current HMR `timestamp` on all invalidated modules' `lastHMRTimestamp` property, forcing Vite's `importAnalysis` to rewrite module imports with updated timestamp query parameters (`?t=...`).

---

## §3 — Virtual Module Orchestration

Zintl uses virtual modules to decouple the source code from the translation data.

### §3.1 — The Manager Module

- **Path**: `virtual:zintl/manager/<locale>/<boundaryId>`
- **Role**: Serves as the "Smart Manager". It knows how to load catalogs for every locale.
- **HMR Behavior**:
  - The manager includes an `import.meta.hot.accept()` block.
  - In development mode, the manager is exported as an Immediately Invoked Function Expression (IIFE) to perform **Synchronous Self-Registration** (`globalThis.__zintl_active.registerLoader`) upon module evaluation.
  - When invalidated, it re-fetches its internal state, re-executes, and registers its new loader. This synchronous self-registration executes before importing components run, ensuring catalogs are populated in time.

### §3.2 — The Content Module

- **Path**: `virtual:zintl/content/<locale>/<boundaryId>`
- **Role**: Provides the raw JSON translation data.
- **HMR Behavior**:
  - When a translator edits a JSON file on disk, the compiler flushes the change to the virtual content module.
  - Invalidation of this module causes all dependent Managers to re-import the fresh data.

---

## §4 — Fast Replacement vs. Hard Reload vs. SSR Auto-Refresh

Zintl prioritizes **Fast Replacement** to maintain developer flow, with selective fallbacks for SSR environments.

### §4.1 — Fast Replacement (The Warm Path)

Triggered when:

- A translation string is updated in a JSON file.
- A static asset (.txt, .md) is modified.
- A sink is added or removed without changing the boundary hierarchy.

**Mechanism**:
The `import.meta.hot.accept()` in the virtual manager allows the module to update in-place. The runtime `registerLoader` updates the `globalRegistry`. Existing UI sinks (using the `t()` function) will pick up the new strings on their next reactive update.

### §4.2 — Hard Reload (The Structural Path)

Triggered when:

- A new `zintl()` anchor is added or removed.
- A dynamic import (`$L`) is added, creating a new Colony.
- A file's ownership moves between boundaries.

**Mechanism**:
In these cases, the structural integrity of the graph has changed. Vite's standard HMR bubbling will eventually trigger a hard reload if the change cannot be safely hot-replaced at the entry level.

### §4.3 — Server-Side Auto-Refresh (The SSR Path)

Triggered when:

- A server-only boundary (e.g., `entry-server.ts`) or its server-side disk catalogs are modified.

**Mechanism**:
Since browser-based HMR cannot execute HMR updates for modules not imported in the client graph, server-only updates are untracked by the browser. To resolve this, Zintl tracks SSR vs client transformations. If an update affects a boundary in `ssrBoundaries` but not `clientBoundaries`, Zintl sends a `{ type: 'full-reload', path: '*' }` WebSocket message to the browser, prompting a full page refresh to fetch the newly server-rendered HTML.

### §4.4 — Synchronous HMR Catalog Injection (Framework Agnostic HMR)

Zintl supports instant, framework-agnostic HMR updates without requiring components to subscribe to store notifications.

**Mechanism**:

1. When a source component or catalog JSON file is updated, Vite invalidates the component file, the entry manager, and the affected virtual content modules (`virtual:zintl/content/...`).
2. Vite's HMR client fetches and executes the updated virtual content module in the browser.
3. The content module's evaluation code synchronously invokes `globalThis.__zintl_active.addCatalogs({ [locale]: catalog })`, updating the active store immediately.
4. Because module evaluation completes _before_ Vite executes HMR updates inside the components (e.g. React Fast Refresh or Vue SFC updates), the Zintl store is already fully hydrated with the new translations by the time the component re-renders.
5. Consequently, the translation resolver `_t` retrieves the updated translations on the very first render tick.

---

## §5 — Asset HMR ($AS$)

Static assets participate in a specialized HMR track.

1. **Global Boundary**: All assets are mapped to a single virtual boundary: `b_assets`.
2. **Entry Dependency**: In development mode, every entry point is automatically marked as a dependent of `b_assets`.
3. **Trigger**: Updating `about.txt` or `about.ar.txt` invalidates `b_assets`.
4. **Cascading**: This invalidates the virtual managers of all entries, causing the runtime to reload the asset mapping and refresh the UI.

---

## §6 — Troubleshooting & Diagnostics

- **504 Outdated Dep**: Often caused by Vite trying to optimize virtual modules. Zintl explicitly excludes itself from optimization to prevent this.
- **Missing Update**: Check if the file is correctly categorized (Anchor, Marker, Sink). If a file has no Zintl symbols, it is a Vassal and its updates bubble to the nearest parent Kingdom.
- **Flicker**: Ensure `import.meta.hot.accept()` is correctly present in the generated manager code.
- **Blank/Empty Rendering on First HMR Update**: Check if the translation resolver (`_t`) returns an empty string fallback before a newly registered synchronous loader updates the catalogs. Ensure that `_t` immediately re-evaluates the catalog lookup right after executing `registerLoader` to recover the resolved message on the first render tick.
- **Shared/Lazy Component HMR Invalidation Failures / Nested Anchor Invalidation**: If component or catalog updates do not trigger manager invalidation, verify the boundary graph reachability traversal (`isReachable`). Reachability checking must support mapping boundary IDs back to file paths and matching them correctly, ensuring that nested entry anchors (like `bootstrap()` functions) propagate HMR invalidations from dependencies back to their virtual manager modules.

---
