---
"@zintljs/compiler": minor
"zintljs": minor
"@zintljs/testing": patch
---

Rsbuild is now a supported target for SPA builds **and dev-time hot updates**. Editing a string under `rsbuild dev` updates the page without a reload, on the source locale and on lazily-loaded ones alike.

Proposal 028 §6 had refused promotion for a structural reason rather than a bug count: HMR was the one bundler concern not mediated by a facet — its orchestration lived inside the plugin's `vite: {}` escape hatch, and that it never ran anywhere else was an accident of unplugin dropping that block. Proposal 029 builds the seam:

- **`HostUpdateApplier`** (`packages/zintl/src/hmr/`) splits the hot-update path along the line 028 §6.1 drew: `hmr/plan.ts` decides what changed using only host-neutral compiler calls, and each host's applier applies that decision in its own vocabulary. Vite's `ModuleGraph` surgery moves there unchanged. Appliers are _contributed_ by each host's escape hatch, never selected — there is no `switch (bundler)` in the hot-update path.
- **`BundlerFacet.hotUpdate`** is the facet's half: the declaration that a bundler has an applier, visible to the composition guardrail and to a registration fence. Distinct from the existing `hmr` flag, which only says acceptance code is emitted.
- **`BundlerFacet.dependencyInvalidation`** captures the deeper difference the work uncovered. Vite's hot-update hook _asks_ what to invalidate; Rspack asks nothing and rebuilds whatever its own dependency graph says is stale. So on Rspack the generated catalogs declare what they are derived from (`ZintlCompiler.getBoundaryInputs`) and are rebuilt in the same compilation as the edit. Declaring the same dependencies on Vite is not redundant but harmful — it makes Zintl's own catalog writes re-enter as source changes — so `viteFacet` deliberately does not.
- `rspackFacet` now emits real acceptance code via `import.meta.webpackHot`. It ignores `hmrSelfAcceptCode`'s callback argument on purpose: Webpack treats that callback as an **error handler** and re-executes the module body instead, so Vite's shape would have silently registered catalog re-registration as a handler that never fires.

**A latent runtime defect on Vite, surfaced by the second host (ledger L-028).** The receiver had two ways to load a boundary and only one of them published what it was doing: `registerLoader` (which a generated manager runs as it evaluates) tracked its async load in `pendingBoundaries` only, while `loadLazyBoundary` joins concurrent loads through `inFlight` — and tested "already loaded" _before_ "already loading". A pull arriving during a push was therefore handed the stale catalog and returned in zero milliseconds. Because Zintl has no source-locale fallback, every key that existed only in the incoming catalog rendered as blank text that nothing later repaired.

Vite never showed it: it re-imports the whole dependency chain with a fresh `?t=`, so the content module applies before the entry re-renders. Rspack re-executes the manager and the entry as independent modules, so the two genuinely interleave. `registerLoader` now publishes its load in `inFlight`, and `loadLazyBoundary` checks for an outstanding load before answering from what it holds — a load is outstanding precisely because something decided the present catalog needs replacing. Guarded by a new `delivery-refresh` contract that drives the interleaving deliberately rather than waiting for the race: five projects fail without the fix and pass with it, four of them Vite.

Also fixed, all found on the supported path (ledger L-024 – L-027): the dev/build discovery gate was keyed on a Vite-only field, so every Rsbuild rebuild re-discovered the whole project; four hardcoded `import.meta.hot` literals in the asset branches bypassed the bundler facet; boundary inputs were reported as normalized ids rather than real paths; and discovery needed to share its in-flight promise rather than a flag, since `buildStart` is a parallel hook on Rspack.

`@rsbuild/core` is now declared as an optional peer dependency (tested against `^2.1.0`); `vite` becomes optional too, since neither is required. `multiplex` (per-locale HTML fan-out) and SSR remain Vite-only, and `multiplex` is now documented as a permanent exclusion rather than a pending one.
