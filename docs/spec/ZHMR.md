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

### §4.2 — The Structural Path

The graph's **shape** has changed, rather than its contents:

- A new `zintl()` anchor is added or removed.
- A dynamic import (`$L`) is added, creating a new Colony.
- A file's ownership moves between boundaries.

**The invariant, in both cases below**: the runtime must not be left holding a boundary map that
describes the previous build. Replacing a module in place while its boundary map still names
boundaries that have moved is the failure this section exists to prevent — and because Zintl has no
source-locale fallback, the symptom is not a stale string but an empty one.

There are two correct ways to satisfy that, and which applies is decided by the **entry and the
host**, not by the kind of change:

#### §4.2.1 — Re-execution-safe entries hot-replace

When the entry module can be safely re-run — `entryReexecutionSafe`, resolved from the framework's
runtime facet — the re-executed entry rebuilds the boundary map itself. The structural change is then
absorbed in place, and a reload would discard application state to reach a state the update already
reached.

**The host has a veto**, and it is the half this section originally missed. A new boundary is a new
catalog chunk, and a host that answers a changed entrypoint chunk set with a full reload does so
before Zintl is consulted — measured on Rspack, where `plan.fullReload` is `false` for exactly the
edits that reload. `BundlerFacet.absorbsStructuralChange` states it, defaulting to `true`, and a
project takes §4.2.1 only when the framework _and_ the host both allow it (ledger L-074).

**Mechanism**: the compiler emits a self-accepting snippet for the entry. The update arrives as an
ordinary `update`; the boundary graph grows; the page is correct on the next render.

#### §4.2.2 — Everything else reloads

When the entry is not re-execution-safe, in-place replacement is not merely slower but wrong: the
module that would accept the update is no longer the module that owns the code. The same route
applies, for a different reason, wherever the host cannot absorb a graph change at all.

**Mechanism**: the update bubbles until it becomes a full page reload. Hosts reach that differently —
Vite accepts and then calls `import.meta.hot.invalidate()`, while Rspack has no `invalidate()` and
instead declines to accept at all, so the update bubbles for want of a handler (see §5a).

> **Where this exception came from.** The section originally specified a hard reload for every
> structural change, with no exception. The `hmr-growth` contract asserted that and found the
> implementation disagreeing on purpose: adding a nested `zintl()` anchor to a re-execution-safe
> entry produced an ordinary `update`, no reload, and a correct page — confirmed by reloading
> afterwards and re-asserting, so the runtime was demonstrably not left holding a stale boundary map.
> The specification was the thing that was wrong, and it has been changed rather than the code
> (ledger L-061).

### §4.3 — Server-Side Auto-Refresh (The SSR Path)

Triggered when:

- A server-only boundary (e.g., `entry-server.ts`) or its server-side disk catalogs are modified.

**Mechanism**:
Since browser-based HMR cannot execute HMR updates for modules not imported in the client graph, server-only updates are untracked by the browser. To resolve this, Zintl tracks SSR vs client transformations. If an update affects a boundary in `ssrBoundaries` but not `clientBoundaries`, Zintl sends a `{ type: 'full-reload', path: '*' }` WebSocket message to the browser, prompting a full page refresh to fetch the newly server-rendered HTML.

**Precondition — the page has to be listening.** Zintl broadcasts; the _host's_ HMR client is what
acts on the packet, so §4.3 holds only where the served document carries it. Two ways an SSR app
loses that without any sign of it, both measured (ledger L-072):

- **A document Zintl or the app builds itself**, rather than one passed through
  `transformIndexHtml`, has no client script injected into it. The broadcast reaches nothing.
- **A dev server in middleware mode** has no listener for the host to attach the HMR WebSocket to,
  so unless the app passes one (`server: { middlewareMode: true, hmr: { server } }`) the host opens
  its own on a fixed port. A second SSR app on that machine then either fails to bind or answers the
  first app's browser.

Neither is visible from the server: the broadcast is sent, logged and counted in both cases. A
reload that does not happen and a reload that happens onto stale output look identical unless the
_client_ is observed, which is what the contract for this section now does.

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

## §5a — Host Parity

Everything above §5 is written in Vite's vocabulary, because Vite was the only host when it was
written. Most of it is genuinely host-neutral and one part of it is not, and the difference matters:
a reader implementing a third bundler facet needs to know which sentences are requirements and which
are one host's way of meeting them.

The two supported hosts are **Vite** (`viteFacet`) and **Rspack** (`rspackFacet`, which Rsbuild rides
through unplugin). Read the table as _feature → how each host provides it_.

| Feature                             | Vite                                                        | Rspack                                                                             |
| :---------------------------------- | :---------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| §2.2 changed-file hook              | `handleHotUpdate` / `hotUpdate`                             | `compiler.hooks.watchRun` + `modifiedFiles`                                        |
| §2.2 ordering authority             | the hook's `timestamp`                                      | `Watching.startTime`                                                               |
| §2.2① direct invalidation           | the returned module list                                    | **not applicable** — Rspack rebuilds from its own graph, and asks nothing          |
| §2.2③ entry-point cascading         | boundary→path traversal, then an explicit invalidation walk | declared dependencies (`getBoundaryInputs` → `watchedFiles` → `addWatchFile`)      |
| §2.2④ timestamp propagation (`?t=`) | `lastHMRTimestamp` on each invalidated module               | **no equivalent** — the host owns cache-busting via `<chunk>.<hash>.hot-update.js` |
| §3.1 manager self-registration      | the IIFE, identically                                       | the IIFE, identically                                                              |
| §3.1 `accept()` spelling            | `import.meta.hot.accept(cb)`, callback re-registers         | `import.meta.webpackHot.accept()`, **callback dropped** — re-execution suffices    |
| §3.2 / §4.4 `addCatalogs` injection | identical                                                   | identical                                                                          |
| §4.2 bubbling to a reload           | accept, then `import.meta.hot.invalidate()`                 | **decline to accept** — there is no `invalidate()`, so it bubbles for want of one  |
| §4.3 SSR full-reload                | `server.ws.send({ type: "full-reload", path: "*" })`        | `sockWrite("full-reload")` — channel exists, but SSR is unbuilt, so never fires    |
| §5 `b_assets` cascade               | explicit entry fan-out (`entryFilePaths`)                   | the asset is a real `?zintl-raw` import, so the graph makes the chunk stale        |

Three entries deserve emphasis, because they are where a naive port goes wrong:

1. **"Invalidate these modules" is not the universal shape.** Vite's hook hands over an event and
   takes back a module list. Rspack asks nothing — it rebuilds whatever _its_ dependency graph says
   is stale, so a generated catalog that declares no dependencies is never stale however loudly a
   hook shouts. The portable requirement is "the host must be able to learn what a generated module
   is derived from", satisfied _either_ by per-module invalidation _or_ by declared file
   dependencies. `BundlerFacet.dependencyInvalidation` is how a facet says which, and declaring both
   is a defect rather than belt-and-braces: on a host that honours an explicit list, also declaring
   the catalogs as dependencies makes Zintl's own `flush()` writes re-enter as source changes.

2. **§4.2's mechanism is not "Vite's standard HMR bubbling".** That is one host's route to the
   outcome. The outcome — a structural change reaches the browser as a reload rather than as an
   in-place replacement — is the specification; accepting-then-invalidating and declining-to-accept
   are two ways to produce it.

3. **§4.3 is Vite-only in practice, not in principle.** The decision is host-neutral
   (`ssrBoundaries` minus `clientBoundaries`) and both hosts expose a server→client channel. What
   Rspack lacks is any SSR support to populate `ssrBoundaries` in the first place, so the branch is
   unreachable there. That is a scope boundary, not a missing mechanism.

---

## §6 — Troubleshooting & Diagnostics

- **504 Outdated Dep**: Often caused by Vite trying to optimize virtual modules. Zintl explicitly excludes itself from optimization to prevent this.
- **Missing Update**: Check if the file is correctly categorized (Anchor, Marker, Sink). If a file has no Zintl symbols, it is a Vassal and its updates bubble to the nearest parent Kingdom.
- **Flicker**: Ensure `import.meta.hot.accept()` is correctly present in the generated manager code.
- **Blank/Empty Rendering on First HMR Update**: Check if the translation resolver (`_t`) returns an empty string fallback before a newly registered synchronous loader updates the catalogs. Ensure that `_t` immediately re-evaluates the catalog lookup right after executing `registerLoader` to recover the resolved message on the first render tick.
- **Shared/Lazy Component HMR Invalidation Failures / Nested Anchor Invalidation**: If component or catalog updates do not trigger manager invalidation, verify the boundary graph reachability traversal (`isReachable`). Reachability checking must support mapping boundary IDs back to file paths and matching them correctly, ensuring that nested entry anchors (like `bootstrap()` functions) propagate HMR invalidations from dependencies back to their virtual manager modules.

---
