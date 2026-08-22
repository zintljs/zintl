---
"zintljs": patch
---

Fixed two defects on the dev path that a Vite-only host could not distinguish (ledger L-024, L-025).

**L-024 — the discovery gate was a Vite artifact.** `hooks/build.ts` decided whether to run the full `discover()` pass with `if (!ctx.server)`. `ctx.server` is assigned only by Vite's `configureServer`, so the test read "am I in a Vite dev server" while standing in for "am I building" — indistinguishable on Vite, where the two agree in `dev`, `build` and `preview` alike. On Rsbuild nothing assigns it, and `buildStart` is tapped to `compiler.hooks.make`, which fires once per _compilation_ — so every incremental rebuild re-discovered the entire project before building a single module. Now `if (!ctx.compiler.isDev)`, which is truthful on both hosts as of L-020's `hostHints` merge.

**L-025 — four hardcoded `import.meta.hot` literals bypassed the bundler facet.** The `?raw` / `?zintl-raw` localized-asset branches in `hooks/resolve.ts` wrote Vite's HMR API out as string literals, the same class of leak L-014/L-015/L-016 found in the codegen hooks and `rspackFacet` exists to stop. L-014 had already dev-guarded one of these sites, which fixed the production leak while leaving the cause in place: dev-guarding Vite's API still emits Vite's API. All four now route through `_resolved.system.hmrSelfAcceptCode`. `viteFacet`'s output is byte-identical to the literals it replaces, so the change is inert on Vite; on Rspack it stops emitting a reference the host never defines.
