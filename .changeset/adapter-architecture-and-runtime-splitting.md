---
"@zintl/compiler": minor
"zintl": minor
---

Introduced a modular, conflict-free **Adapter Architecture** that decouples framework-specific and toolchain-specific capabilities into discrete concerns. Framework presets (`"react"`, `"vue"`, `"svelte"`, `"vanilla"`, `"html"`, `"nextjs"`) and runtime/bundler layers (`"ssr"`, `"vite"`, `"client-spa"`) compose dynamically into a resolved capabilities map. Key changes include:

- **Environmental Runtime Splitting**: Decomposed `store.ts` into environment-gated modules (`store-core.ts`, `store-client.ts`, and `store-server.ts`). Vanilla applications now bundle only core translation states, while SPA router synchronization popstates and server request-scoped `AsyncLocalStorage` logic are loaded dynamically on demand.
- **Vite Plugin Decoupling**: Refactored the Vite plugin config hook to utilize the compiler's presets engine, auto-injecting the `"vite"` preset and detected frameworks, which cleans up hundreds of lines of duplicate codegen and SSR wrapper regexes.
- **Extension Preservation**: Retained full source file extensions (like `.tsx`, `.jsx`, `.svelte`, and `.vue`) in the boundary ID normalization and compiler maps to prevent naming clashes between files sharing the same base name.
- **Boundary & Catalog Alignment**: Resolved a bug causing duplicate catalog and schema files (e.g. `App.ar.json` vs `App.svelte.ar.json`) by passing pre-resolved extensions and adapters directly to the `IOManager` constructor to unify normalized paths.
- **Backward Compatibility**: Embedded fallback translation from `options.targets` to their preset adapters to ensure full compatibility with existing configuration blocks.
