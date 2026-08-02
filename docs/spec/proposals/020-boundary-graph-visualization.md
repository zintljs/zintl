# Proposal 020: Boundary Graph Visualization (The Zintl Map)

## Context

As Zintl projects grow, the **Boundary Graph** becomes a complex web of "Dictator" entries, "Primal" entries, and "Shared" chunks. Understanding why a specific translation was consolidated into a particular manager or why a shared chunk was created is currently only possible by reading the `internalManifest` or debugging the compiler itself.

## Proposed Logic Transformations

### 1. The Metadata Export

The `ZintlCompiler.flush()` method already saves the `graph` and `metadata` to the `manifest.json`. We should formalize a standard `zintl-map.json` output that includes coordinates, usage counts, and reachability paths.

### 2. Interactive Reporter

Implement a lightweight, standalone HTML reporter (similar to `rollup-plugin-visualizer` or `webpack-bundle-analyzer`). This reporter will visualize:

- **Managers (Nodes)**: Visualized by size (number of strings).
- **Dependencies (Edges)**: Static vs. Dynamic imports.
- **Entry Points**: Highlighted targets that trigger hydration.

### 3. Vite Plugin Integration

Add a `zintl-map` command or a special dev-server route (e.g., `/__zintl_map`) that serves the visualization in real-time during development. This allows developers to see the immediate architectural impact of moving a `zintl()` call or refactoring a component boundary.

## Expected System Proofs

- **Architectural Clarity**: Developers can "see" their i18n graph and optimize consolidation boundaries visually.
- **Performance Auditing**: Easily identify "Heavy" boundaries that are leaking translations into the wrong chunks.
- **Micro-Frontend Orchestration**: Visualize how different micro-frontends share (or isolate) their translation managers.
