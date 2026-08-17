# @zintljs/testing

## 0.1.0-alpha.16

### Patch Changes

- 33cc981: Build snapshots no longer pin the order Rspack happens to write modules in.

  `[Production Build] rsbuild-vanilla-basic` passed on every developer machine and failed on CI, with a
  diff that looks alarming and means nothing: module `8` — the raw asset text, which imports nothing —
  appearing before module `12` locally and after it on CI. Same ids, byte-identical bodies, different
  sequence. A chunk is emitted as `push([[3], { 7(…){…}, 8(…){…}, 12(…){…} }])`, and which module lands
  where depends on the order the build _finished_ them, which is timing and therefore machine.

  `filterDistForSnapshots` now sorts module blocks by id, so the snapshot asserts what the bundle
  contains rather than what order the bundler wrote it in. Sorted rather than stripped: a module
  appearing or disappearing still fails, which is the part that matters. Files without that shape pass
  through untouched, and an unterminated block leaves the file exactly as it was rather than emitting a
  half-reordered approximation.

  Regenerating the 24 affected snapshots produced 100,052 insertions against 100,052 deletions, and the
  sorted line multiset is identical before and after — confirmed per file, so the update is provably a
  permutation and not a content change.

  Separately, `describeStall` no longer attaches browser diagnostics to failures in project mode.
  `build`, `graph` and the transform contracts run without a page, and this one reported
  `hmr packets: unavailable`, `settle beacon: unreadable` and — on a production bundle snapshot
  mismatch — `← the page itself is the failure`, pointing an investigation at a browser that was never
  opened. The compiler ledger and HMR trace are genuinely useful there and are kept; the browser-side
  sections are skipped rather than answered wrongly, under a `── build diagnosis (no page) ──` header.

- 8064f19: A flush deferred by another flush now gets a trigger of its own.

  `flush()` hands a mid-flush caller the in-flight promise and settles `dirt retained for the next`,
  justified by "the debounce timer is already scheduled by the `transform` that dirtied it". That holds
  for every trigger except the last one: `scheduleFlush()` _replaces_ the timer, and when it fires
  `flush()` clears it, finds a run already in flight, and returns — leaving nothing scheduled. If no
  further change arrives, the retained dirt is never flushed at all.

  Measured on a boundary rename: two flushes, one catalog prune that ran _before_ the rename, and a
  catalog write that simply never happened. The signal for it,
  `flush #N → superseded (joined the in-flight flush; dirt retained for the next)`, appears 68 times
  across one session's captured diagnoses and had been read as background noise throughout.

  `armTrailingFlush` re-arms the **debounce timer** once the in-flight run settles, rather than running
  a follow-on flush. That is the difference from the two attempts this replaces: further changes
  coalesce into the timer, so a burst costs one extra pass at the end rather than one per update. It
  cannot livelock, because nothing is armed unless dirt actually remains, at most one arm exists per
  in-flight run, and a trailing flush that leaves the dirt unchanged does not arm another — while a
  real edit clears that guard so genuine work is never refused. `hmr-hammer`, the contract the earlier
  follow-on destabilised, measures 0 failures in 10 runs.

  `noOrphanedCatalogs()` needed fixing to see any of this: it read the filesystem the instant the DOM
  settled, mid-way through work already scheduled. Awaiting `flush()` once is not enough either, since
  a mid-flush caller receives the in-flight promise. `flushUntilQuiescent` loops on the dirty set
  rather than a clock, so it terminates because there is no dirt left rather than because time passed.

  `[Chaos Boundary] vue-basic` passes 10 runs in 10. `svelte-basic` stays pending for an unrelated
  defect the shared skip had been hiding — proposal 024 §1.3's double mount, measured 6/10 under
  contention and 0/10 in isolation.

- d2ffd5b: The delivery contracts no longer assume how an app was chunked.

  `delivery-ordering` and `delivery-refresh` found their probe boundary by scanning the store for the
  one carrying the app's heading, and aborted when none did. That is really a claim that the asserted
  string arrives in a _registered_ catalog rather than one the manager _inlines_ — and on an app whose
  heading sits in the entry's own boundary, it does not hold. Both contracts aborted on a project where
  delivery demonstrably works, which cost that project a capability it had already earned.

  `pickDeliveryProbe` prefers the boundary carrying the heading, falls back to any registered one, and
  fails only when the store holds no catalogs at all for the active locale. Axiom D1 and the push/pull
  join are properties of the receiver rather than of any particular boundary, so this needs no
  per-project answer — which is why it is a fallback rather than a new adapter field. When the fallback
  fires, `carriesKey` records that the probe was a stand-in rather than hiding it.

  `examples/rsbuild-vanilla-mpa` claims `hmr` as a result, measured at 0 failures in 10 runs across
  `hmr`, `syntax-recovery` and the three delivery contracts. See ledger L-056.

- cd4eae5: `hmr-first-tick` no longer reports an absent element as a blank render, and asset HMR reclaims Rspack.

  The contract sampled the heading with `document.querySelector(sel)?.textContent ?? ""`, which yields
  `""` for an element that is **absent** exactly as readily as for one that is empty. On an app that
  clears its container, `await`s a dynamic import and then paints, that reads as
  `"Lazy colony"` → `""` → `"First tick works!"` — which was written up as ZHMR §6's "Blank/Empty
  Rendering on First HMR Update" and entered in the ledger as a product defect. It was neither: for the
  duration of the await there is simply no heading in the document, no translation is involved, and no
  catalog is late.

  The two states are now distinguished. What §6 actually describes still fails the contract — the
  element **present** with empty text, which is what a resolver miss looks like when there is no
  source-locale fallback. Green on all nine projects, 0 failures in 10 runs. Ledger L-060 is withdrawn
  with the reasoning kept, because a probe that cannot tell _not rendered yet_ from _rendered as
  nothing_ will manufacture defects in every asynchronously repainting app it meets.

  `[Asset HMR] rsbuild-vanilla-basic` also returns, unrelated to any asset change: it was pending on a
  later rebuild restoring the old text, which was L-064 — an update nothing in the page could act on.
  Fixing that cleared this. Measured 0 failures in 10 runs, so ZHMR §5 now holds on both hosts.

- 6a3d1b8: Fix Vue on Rsbuild, and rebuild the Rsbuild examples as `create-rsbuild` starters across all four frameworks.

  **The fix.** Vue on Rsbuild built green and shipped the source locale. Extraction, catalog scaffolding, `verifyIntegrity`, chunk alignment and the HTML projection were all correct — only the code generation was missing, so a page rendered English under a Spanish `<title>`. The cause was one skip in Zintl: `hooks/transform.ts` ignored every id containing `?vue`, which is right on Vite (that id names a virtual module holding one block of the SFC) and wrong on Rspack (`vue-loader`'s pitcher rewrites it into a request that re-reads the whole file). Zintl was transforming the parent request, which is discarded, and skipping the block requests, which become the code.

  Whether a block request carries the whole file is a fact about the **bundler**, so it is now a bundler-facet declaration — `BundlerFacet.sfcBlockRequestsCarryWholeFile`, `true` on `rspackFacet`, undeclared on `viteFacet` — and `hooks/transform.ts` asks it instead of matching a query string. Vite's behaviour is unchanged by construction. Written up as L-051.

  **The examples.** The two Rsbuild examples were never written to be examples: they grew out of proposal 026's falsification harness and were Vite's starter with the branding torn out, with names (`rsbuild-spa` = vanilla, `rsbuild-react` = no pattern) that did not say what they were. They are now `rsbuild-<framework>-<pattern>`, and each reads as "I ran `pnpm create rsbuild`, then added localization": the page, the CSS and the mount point are the template's, and what is added is the four-locale switcher, `?lang=`, the catalogs, and the `index.html` Zintl needs to localize `<title>` and `<html dir>`.

  Renamed: `rsbuild-spa` → `rsbuild-vanilla-basic`, `rsbuild-react` → `rsbuild-react-basic`.

  New, each in the contract suite with capabilities earned one contract at a time:

  - **`rsbuild-vue-basic`** — the app that found L-051 and now guards the fix.
  - **`rsbuild-svelte-basic`** — Svelte 5 on Rspack; it needed no Zintl change at all.
  - **`rsbuild-vanilla-spa`** and **`rsbuild-vue-spa`** — a hand-rolled router and `vue-router`, each with a lazy `await import()` route, so catalog splitting on Rspack is demonstrated for a boundary the entry never imports statically.
  - **`rsbuild-vanilla-mpa`** and **`rsbuild-vue-mpa`** — two `source.entry` keys, two HTML templates, and a shared component that anchors itself. The first projects on either host to drive Zintl's multi-entry HTML path, which `hooks/html.ts` was written for and nothing had run.

  The support statement moves with the evidence: Rsbuild now covers all four frameworks, single-page and multi-page, in build and dev. `multiplex` and SSR remain Vite-only.

  **Two limitations found on the way, both documented rather than fixed.** Vue's Options API has never worked on either host — a plain `<script>` compiles its template into a separate render function where the helpers Zintl injects are not in scope, and the render throws `_ctx._t is not a function`; every Vue example here uses `<script setup>`, which is why it had never surfaced (L-053). And an inline arrow in a Svelte event attribute on an element with extractable text makes the stitched unit start inside the attribute, producing unparsable output — also on both hosts.

  Also here: the `hmr` capability is not claimed on the new projects, and the reason is measured rather than assumed — an edit to a string in a boundary the runtime has to _fetch_ loses the race with the catalog write when the page full-reloads (10 failures in 10 on Svelte, against React and vanilla passing 10 in 10 in the same batch).

  Two build-snapshot stability defects were found and fixed on the way, both of which had first been read as flake. `examples/rsbuild-svelte-basic` pins Svelte's `cssHash`, whose default hashes the absolute filename and made its snapshot depend on which test worker copied the project (L-052). And `@zintljs/testing`'s `sanitizeCode` now normalises `clonedRuleSet_N`, which `VueLoaderPlugin` numbers from a module-scoped counter that accumulates across every Vue project a worker compiles (L-054).

  Documentation that described Rsbuild as an unsupported falsification target has been corrected in four places, and the `18 example apps → 72 contract tests` counts, already stale, are now 27 and 199.

  **The performance gate was failing on machine state, and now scales properly.** `vpr bench` had started reporting regressions that were not there: on one laptop, `Structural HMR Latency` measured 0.44 ms against a recorded 0.2139 ms and `Colony HMR Latency` 0.75 ms against 0.4124 ms — on identical code, verified by building the original commit in a worktree and running it alongside. The machine had 14 GB of 15 GB swap in use. The calibration that exists to absorb exactly that could not see it, because it was a `Math.sin` loop: it stays in L1, allocates nothing, never provokes the collector, and reported the machine 1.00× while every allocation-heavy path had halved in speed.

  Four changes came out of it. The calibration workload now allocates a working set large enough to touch fresh pages, builds strings, sorts and serializes, so it degrades with the resources the benchmarks depend on — its size mattered as much as its shape, since a first attempt at 48 short-lived strings never grew the heap and so missed `Extract Long File`, which builds a large native AST, entirely. Across the suite that took normalised ratio spread from 54–121% down to 1–9%. Budgets are expressed as multiples of that calibration rather than as milliseconds plus a separate reference constant, so there is no second number to keep in step and nothing to drift apart from. The comparison moved from the mean to **p75**, after a run where `Fast-Path (No Translations/Sinks)` reported mean 0.1183 ms against p75 0.0549 ms and max 16.3 ms — two stalled iterations moved the mean by 2.2× and failed the gate while p75 sat comfortably inside it. And `vpr ready` now runs the benchmark **second**, right after the package build, instead of last: measured after 27 example builds, a type-aware lint and 800 tests, the same benchmark reads 3.4 ms where it reads 0.5 ms run early.

  A budget failure now also prints the calibration reading and says to check swap before concluding the code regressed, and a missing calibration is a hard failure rather than eight meaningless violations against zero. `vpr ready` went from failing roughly every other run to four consecutive passes.

  **Example typechecks are wired into the gate**, which immediately paid for itself. The Vue and Svelte Rsbuild examples built with a bare `rsbuild build` and their `check` script was run by nothing, so two defects had shipped: `rsbuild-vue-mpa` carried a real type error (`SiteHeader.vue`'s top-level `await` needs `module: es2022+`, which `create-rsbuild`'s Vue tsconfig does not set — swc compiled it happily, `vue-tsc` did not), and `rsbuild-svelte-basic`'s `check` had never worked at all, reporting every component as `Error in vite.config` because `svelte-check` falls back to hunting for a Vite plugin when it finds no Svelte config. Both fixed; the typecheck now runs inside `build`, matching the Vite peers, and verified to fail a deliberately introduced error. `examples/svelte-basic` had the same ungated hole on Vite and is wired the same way.

  **ICU plurals are now exercised on Rspack.** No Rsbuild example touched grammar compilation — only `examples/website` did, on Vite — so ICU on this host was an inference from "baking happens in the compiler". `rsbuild-vanilla-basic`'s catalog now carries real plural forms, in the documented shape: the source stays `` `Count is ${counter}` `` and the grammar lives in the catalog. The emitted Arabic chunk is a native `Intl.PluralRules` call and a conditional chain, with identical branches folded and no parser in the bundle. Clicking the counter in Arabic walks `zero → one → two → few`.

  Also measured and recorded: `hmr` on the four newest projects. `rsbuild-vanilla-mpa` passes the HMR contract 0 failures in 10 — the heading is in the entry's own inlined boundary, so the reload comes back with the text already there — but cannot claim the capability, because `delivery-ordering` and `delivery-refresh` are gated behind it and abort on a contract assumption (they look the heading key up in `catalogs[activeLocale]`, where the entry's own boundary is inlined rather than registered under the ghosted source locale). `rsbuild-vanilla-spa` and `rsbuild-vue-spa` fail 10 in 10 and `rsbuild-vue-mpa` 8 in 10, all the empty-render reload race. Each manifest carries its own number.

- f33d11d: `chaos-boundary` waits for the compiler to forget a deleted file before asserting on disk.

  A deletion reaches the compiler through the host's watcher, which is asynchronous and outside the
  harness's control. Until the `unlink` lands the boundary is still live, still in the prune's
  known-path set, and its catalogs are correctly _kept_ — so reading the directory first asserts on a
  state that was never wrong. `boundaryForgotten` terminates on the condition rather than on a clock,
  and turns a watcher that never fires into a precise failure instead of a puzzling orphan list.

  It did not fix the flake it was written for, and that is recorded rather than glossed: `svelte-basic`
  moved from 5/10 to 6/10 failing, which is noise, and the wait passes on every failing run. The
  assertion was not racing the watcher.

  **What the investigation did establish is a corrected diagnosis.** This contract's header has long
  attributed `svelte-basic`'s failure to proposal 024 §1.3 — the entry re-executing and Svelte's
  `mount()` appending a second copy. Measured, every failure is the orphan assertion instead, and the
  instrumented prune shows the files deleted correctly and then present again by the time the assertion
  reads them. Something re-materialises the catalogs of a boundary already reclaimed; the writer has not
  been identified, and `removeFile`'s `markDirty` — the obvious candidate — was tried and reverted,
  because it moved the rate only within noise and a unit test states its opposite intent outright.

  Ledger L-071 carries the measurements and names the next probe: a timestamped log of catalog writes
  interleaved with the prune's decisions. Both halves are already instrumented; their order is what is
  missing.

- ed5965d: Hot-update contracts cover what ZHMR specifies, and stop guessing where files live.

  Most of `docs/spec/ZHMR.md` had no contract behind it. Nothing edited a translation catalog and
  checked the page followed — the most common thing anyone does with an i18n toolchain. Nothing edited
  a static asset, so §5's `b_assets` cascade was unobserved on both hosts. Nothing edited a server-only
  boundary, so §4.3's full-reload broadcast was specified, implemented and never executed. Nothing
  distinguished a change that fits the boundary graph from one that reshapes it (§4.1③ vs §4.2). And
  because every assertion polls with `textEventually`, a heading that flashed empty mid-update — ZHMR
  §6's named failure mode — polled green.

  Five contracts close that: `catalog-edit`, `asset-hmr`, `hmr-server-refresh`, `hmr-growth` and
  `hmr-first-tick`. Three new capabilities carry the claims that need a per-project answer —
  `asset-hmr`, `hmr-server-refresh` and `hmr-structural` — each earned only with the matching adapter
  field declared, the relationship `chaos` already had with `renameBoundary`.

  **Hot updates are no longer gated on `spa`.** Every HMR contract required `["spa", "hmr"]`, and `spa`
  was doing no work `hmr` did not already do — what it did instead was exclude SSR by accident, so
  `react-ssr` carried a `hmr` capability that selected zero tests. Hot updates are not a property of
  client-side routing.

  **Three places guessed at paths a compiler had already resolved**, and all three are now asked rather
  than assumed, via `findCatalogFor` and `localizedAssetPath`:

  - `chaos-catalog` tried `src/i18n/translations.json`, then walked `zintl/`, and threw otherwise. It
    had never heard of `src/locales`, where every Rsbuild example keeps catalogs — so `chaos` was
    unclaimable on eight projects because the contract could not find files that were sitting there.
  - `noOrphanedCatalogs` read `(lab.compiler as any).outputDir ?? "src/locales"`, and `LabCompiler` has
    no `outputDir`: the left side was always `undefined`. Not one project claiming `chaos` uses
    `src/locales`, so the directory never existed and the assertion **returned without checking
    anything, on every project, for its whole life**.
  - `catalogContains` joined `<root>/<options.outputDir ?? "locales">/<locale>.json`, a flat layout no
    project here uses, through a property the compiler does not expose.

  `performance-size` filtered catalog responses by four hardcoded Vite URL shapes and so could only
  ever measure zero responses on Rspack — recorded in those manifests as a host that cannot meet a
  budget. It now uses `LocaleSwitchAdapter.isCatalogRequest`, which already existed for this question
  and was already declared there.

  `setTranslation` writes a translation in whichever of the two catalog shapes a project uses — values
  are strings in a per-locale file and objects in a merged one — because a contract that assumed the
  first would silently delete three languages on the second.

  A `lazy-boundary` fixture covers colonies on Vite, which real-application coverage reached only on
  Rspack. (An apparent blank frame it reported there turned out to be the probe conflating an
  absent element with an empty one — withdrawn as ledger L-060.)

  `hmr-warm` splits a capability that was carrying two guarantees: `hmr` says an edit reaches the
  browser, `hmr-warm` says it is hot-replaced rather than answered by a reload. Measured, that line runs
  through the framework rather than the host, which is the `hasClientReactivity` gate of L-030 and L-035
  turned into a manifest claim instead of a paragraph.

  Contracts that measured red are recorded as `pendingFor` carrying the measurement, not fixed — the
  product changes are deliberately a separate pass. The largest is ledger L-064: editing a catalog
  directly is unreliable on Rspack wherever the manager must _fetch_ the catalog rather than inline it
  (10/10 runs failing on two projects, 6–7/10 on four, 0/10 on the two MPAs and on every Vite project).
  That is L-056's defect, still live, exposed by the one mutation no existing contract performs.

- Updated dependencies [a6d0820]
- Updated dependencies [05b34f8]
- Updated dependencies [6edeca3]
- Updated dependencies [8064f19]
- Updated dependencies [eca2c86]
- Updated dependencies [8064f19]
- Updated dependencies [e34d412]
- Updated dependencies [6a3d1b8]
- Updated dependencies [4925f0d]
- Updated dependencies [d04b7d6]
- Updated dependencies [5d8f4d4]
  - @zintljs/compiler@0.1.0-alpha.16
  - zintljs@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- 9604cbd: Fenced ledger L-022: combining `multiplex: true` with a bundler that has no HTML fan-out support now fails fast with a clear `[Zintl] Multiplex is not supported...` error, instead of an opaque `html-rspack-plugin` loader-chain crash on Rspack/Rsbuild.

  Under multiplex (per-locale HTML fan-out), `loadIncludeHook` claims `.html` on the assumption that `loadHook` will serve it — true on Vite, where the fan-out is implemented, and fatal on Rspack: unplugin retypes the claimed template as `javascript/auto`, and the build dies inside `html-rspack-plugin`'s child compilation parsing `<!doctype html>` as JS.

  `BundlerFacet` gains `htmlFanOut?: boolean` — declared `true` on `viteFacet`, deliberately left undeclared on `rspackFacet` — following the same "ask the facet, don't test the bundler string" pattern ledger L-004 established for `isVirtualId`. `host.ts::ensureCompiler` checks the resolved capability against `ctx.getMultiplex()` before constructing the compiler, so the fence fires once, before any module resolution, on every host.

  The real HTML fan-out for Rspack remains undesigned and out of scope (026 §7, 027 §6) — this only replaces a crash with a loud, actionable error. Verified against a real `zintljs/rsbuild` build via a new fixture and contract (`tests/fixtures/multiplex-rsbuild-fence.ts`, `tests/contracts/multiplex-fence.contract.spec.ts`, capability `"multiplex-fenced"`).

- 73c430a: Added a silent, always-on diagnostic trace for `handleHotUpdateHook` (`Context.hmrTrace`), pursuing ledger L-023 / proposal 027 §2.4's HMR ordering defect. Records every hook invocation, both early-return guards, every `mod.file` reassignment the fallback scan performs, and the return outcome — a ring buffer, never a `console.*` call, so it cannot perturb the timing it's observing.

  The first attempt at this used `DEBUG`-gated `vLogger.debug` calls, and testing surfaced a real, separate finding: enabling the exact `DEBUG=zintl:vite` scope needed to see them suppresses `handleHotUpdateHook`'s invocation entirely (measured: 32-40 invocations per run with `DEBUG` unset, 0 across repeated runs with that scope enabled). Recorded in the ledger rather than chased further; the ring buffer routes around it by never printing.

  Surfaced through the test harness via `LabCompiler.hmrTrace` (reusing the existing `globalThis.__zintl_active_contexts` bridge `LabCompiler.instance` already relied on) and automatically included in `describeStall()`'s failure diagnosis, alongside the existing wire-, runtime-, and compiler-ledger sections.

  A ten-run full-suite reproduction pass caught zero `hmr-hammer` failures and zero evidence for the `mod.file`-repointing hypothesis this instrumentation was built to test — inconclusive at this sample size, and the instrumentation is left in place for a future, larger attempt. The pass did catch an adjacent failure (`memory-leak` on `react-basic`) pointing at a different, already-named, still-open item: proposal 024's `entryReexecutionSafe`/React `createRoot` gap. Full writeup in `docs/spec/proposals/027-leak-ledger.md`, L-023.

- bb5eb9a: The Rsbuild dev-server driver now asks the OS for a free port instead of letting every project start from Rsbuild's default (ledger L-036).

  `createLabDevServer` defaults to `port: 0`. Vite reads that as "pick an ephemeral port", which cannot collide; Rsbuild would serve on literal port `0`, so the driver passed `undefined` and every Rsbuild project began at 3000 and auto-incremented. With one Rsbuild example that was invisible — with two on separate workers it is a race, and the loser dies with `EADDRINUSE` while its contract waits out the full 45s timeout, on whichever contract happened to be running.

- 778e1d5: Rsbuild is now a supported target for SPA builds **and dev-time hot updates**. Editing a string under `rsbuild dev` updates the page without a reload, on the source locale and on lazily-loaded ones alike.

  Proposal 028 §6 had refused promotion for a structural reason rather than a bug count: HMR was the one bundler concern not mediated by a facet — its orchestration lived inside the plugin's `vite: {}` escape hatch, and that it never ran anywhere else was an accident of unplugin dropping that block. Proposal 029 builds the seam:

  - **`HostUpdateApplier`** (`packages/zintl/src/hmr/`) splits the hot-update path along the line 028 §6.1 drew: `hmr/plan.ts` decides what changed using only host-neutral compiler calls, and each host's applier applies that decision in its own vocabulary. Vite's `ModuleGraph` surgery moves there unchanged. Appliers are _contributed_ by each host's escape hatch, never selected — there is no `switch (bundler)` in the hot-update path.
  - **`BundlerFacet.hotUpdate`** is the facet's half: the declaration that a bundler has an applier, visible to the composition guardrail and to a registration fence. Distinct from the existing `hmr` flag, which only says acceptance code is emitted.
  - **`BundlerFacet.dependencyInvalidation`** captures the deeper difference the work uncovered. Vite's hot-update hook _asks_ what to invalidate; Rspack asks nothing and rebuilds whatever its own dependency graph says is stale. So on Rspack the generated catalogs declare what they are derived from (`ZintlCompiler.getBoundaryInputs`) and are rebuilt in the same compilation as the edit. Declaring the same dependencies on Vite is not redundant but harmful — it makes Zintl's own catalog writes re-enter as source changes — so `viteFacet` deliberately does not.
  - `rspackFacet` now emits real acceptance code via `import.meta.webpackHot`. It ignores `hmrSelfAcceptCode`'s callback argument on purpose: Webpack treats that callback as an **error handler** and re-executes the module body instead, so Vite's shape would have silently registered catalog re-registration as a handler that never fires.

  **A latent runtime defect on Vite, surfaced by the second host (ledger L-028).** The receiver had two ways to load a boundary and only one of them published what it was doing: `registerLoader` (which a generated manager runs as it evaluates) tracked its async load in `pendingBoundaries` only, while `loadLazyBoundary` joins concurrent loads through `inFlight` — and tested "already loaded" _before_ "already loading". A pull arriving during a push was therefore handed the stale catalog and returned in zero milliseconds. Because Zintl has no source-locale fallback, every key that existed only in the incoming catalog rendered as blank text that nothing later repaired.

  Vite never showed it: it re-imports the whole dependency chain with a fresh `?t=`, so the content module applies before the entry re-renders. Rspack re-executes the manager and the entry as independent modules, so the two genuinely interleave. `registerLoader` now publishes its load in `inFlight`, and `loadLazyBoundary` checks for an outstanding load before answering from what it holds — a load is outstanding precisely because something decided the present catalog needs replacing. Guarded by a new `delivery-refresh` contract that drives the interleaving deliberately rather than waiting for the race: five projects fail without the fix and pass with it, four of them Vite.

  Also fixed, all found on the supported path (ledger L-024 – L-027): the dev/build discovery gate was keyed on a Vite-only field, so every Rsbuild rebuild re-discovered the whole project; four hardcoded `import.meta.hot` literals in the asset branches bypassed the bundler facet; boundary inputs were reported as normalized ids rather than real paths; and discovery needed to share its in-flight promise rather than a flag, since `buildStart` is a parallel hook on Rspack.

  `@rsbuild/core` is now declared as an optional peer dependency (tested against `^2.1.0`); `vite` becomes optional too, since neither is required. `multiplex` (per-locale HTML fan-out) and SSR remain Vite-only, and `multiplex` is now documented as a permanent exclusion rather than a pending one.

- Updated dependencies [8d8f942]
- Updated dependencies [97b4a72]
- Updated dependencies [778e1d5]
- Updated dependencies [9604cbd]
- Updated dependencies [73c430a]
- Updated dependencies [3bdcea8]
- Updated dependencies [b5b5a3d]
- Updated dependencies [8d4c472]
- Updated dependencies [8d7ff57]
- Updated dependencies [778e1d5]
- Updated dependencies [391f5ef]
- Updated dependencies [0d90ac3]
  - @zintljs/compiler@0.1.0-alpha.15
  - zintljs@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- 45e3a9d: Made the localized-assets contract describe a capability rather than one project, so more than one app can claim `assets`.

  The contract imported its expected strings from the `assets-basic` fixture and asserted them against `adapter.headingSelector`. That made it a test of one app wearing a capability's name: any second project claiming `assets` would have been asserted against the first project's text, in whichever element happened to be its heading. It survived only because it had exactly one claimant, for which "the heading" and "the localized asset" were the same element by coincidence.

  The selector and the per-locale expected text now come from a new `AssetsAdapter`, alongside a `navigateLocale` that loads the app cold in a given locale — a fresh navigation rather than a runtime switch, because this contract is about the build substituting the right asset for the active boundary, not about switching afterwards. `assetSelector` is deliberately separate from `headingSelector`: in the normal case they are different elements, which is what the old shape could not express.

  `rsbuild-spa` now claims `assets` and `boundary-graph`. The first is the one that matters — the defect where Rspack typed Zintl's generated JavaScript by its `.txt` extension and base64-encoded it into a `data:` URI had a green build and green contracts, and was caught only by reading a snapshot. It is now asserted in a real browser against rendered Arabic text.

### Patch Changes

- 7779a8b: Gave the HTML projection a host-neutral path, so `<html lang>`/`dir`, `<title>` and `<meta description>` follow the locale on Rsbuild as they do on Vite.

  `compiler.transformHtml()` was always host-neutral; what was not is the only thing that ever called it — Vite's `transformIndexHtml`, which lives in the plugin's `vite` block and which unplugin drops on every other target. Rsbuild's `api.modifyHTML` has the same shape, so this is wiring rather than a second implementation, routed from the plugin's `rsbuild` block. Deliberately **not** a `BundlerFacet` hook: `ContentFacet.transformHtml` already exists and _is_ the projection, so a bundler hook of the same name beside it would reproduce a naming collision this codebase has been bitten by before — and registering `modifyHTML` is plugin work that a facet, being data and string-returning functions, cannot do.

  **Two things had to be solved that a straight wiring would not have caught.**

  _Identity._ Rsbuild hands the hook an output filename (`index.html`, relative to `dist`) where Vite hands an absolute source path. The projection re-reads the source on a cache miss and computes sink offsets against it, so passing the output name through produces a blank page. It is now inverted through `htmlPaths` and `html.template` back to the source id — and when any step yields nothing, which happens for real when Rsbuild uses its built-in template, it warns and declines rather than silently doing nothing.

  _The boundary link._ Zintl learns which scripts a document loads by reading `<script src>` from markup, and turns them into the document's dependencies — which is how a page reaches a trust anchor and becomes a boundary at all. An Rsbuild template names no scripts: the entry is injected at build time from `source.entry`, so the association lives in the build config. With nothing to read, no HTML document reached a boundary on this host, no catalog was ever scaffolded for one, and the direction map came out empty.

  `CompilerOptions.htmlEntries` is the new declaration — keyed by html id, valued with source ids, unioned with whatever the markup says and empty on every host whose templates name their own scripts. It updates both `htmlProjection.scripts` and `dependencies`, because the extractor derives the second from the first _during_ extraction and afterwards they are two separate facts.

  **Also generalised**: the `locale-switch` contract asserted a request URL containing `virtual:zintl/content/<locale>/`, which is Vite's virtual-module spelling — an Rspack build emits catalogs as ordinary hashed async chunks. The question the contract asks is host-neutral; only the spelling is not, so an optional `LocaleSwitchAdapter.isCatalogRequest` holds the per-project answer and defaults to the Vite form.

- 45e3a9d: Promoted the Rsbuild project from a test fixture to a real example at `examples/rsbuild-spa`.

  It began as proposal 026's falsification harness, deliberately living outside `examples/` so it carried none of that directory's obligations. It now has them: it builds under `vpr build:examples`, satisfies lint and knip, and is something a user is invited to copy. Its manifest reads the app through `copiedExampleSource` like every other example, which leaves `dirSource` without a caller — kept, because it is the general "checked-in directory outside `examples/`" source and this removes its only user, not its reason to exist.

  **The gaps are stated in the app itself**, in a rewritten README: no hot updates, no `<html dir>`, no `<title>`/`<meta>` translation, no SSR or MPA. A production-build-only example is still a real example; a `dev` script that starts a server and silently never updates would not be, which is the failure mode the honesty is aimed at.

  **A guardrail was about to vouch for a fiction.** The facet-composition golden files enumerate `examples/` from disk but hardcoded `bundler: "vite"`, including in the invariant asserting that every example resolves exactly one bundler facet. After promotion that would have kept passing — by describing an Rsbuild app as resolving `viteFacet` and asserting the description was right. What it would have been vouching for is the defect where Vite-specific syntax is emitted into Rspack output. The bundler is now derived per example from the config on disk, and the invariant asserts the host's own facet rather than a constant.

  Two smaller corrections came with it: the hand-written `*?raw` type shim is gone in favour of `types: ["@rsbuild/core/types"]`, which Rsbuild ships and which mirrors how the Vite examples use `vite/client`; and `@rsbuild/core` is no longer a root devDependency or a knip exception, since the app declares its own.

- 0926c2e: Routed virtual-module **recognition** through the bundler facet, closing the half of that seam that never existed.

  `BundlerFacet.resolveVirtualPath` existed to construct virtual ids. Nothing existed to recognise them: core tested `id.startsWith("\0")` — Rollup's convention, hardcoded into a bundler-agnostic layer — at seven sites deciding whether a module was Zintl's own, and therefore whether to normalize it, give it a catalog, or let it become a boundary.

  On Rspack that test is false for virtual modules past the `transform` boundary, because unplugin materialises them as real files under `node_modules/.virtual/`. Nothing broke, because an adjacent `id.includes("node_modules")` test happened to be true — correct behaviour resting on another project's choice of directory name, which would have failed silently by extracting strings from Zintl's own generated catalogs the day that directory moved.

  `BundlerFacet.isVirtualId` is the counterpart. It uses substring rather than prefix semantics, because boundary ids embed the module id they were minted from; Rspack's implementation recognises both spellings a virtual module has on that host. `IOManager` holds and exposes it, since every other manager already holds an `IOManager` and none hold the system view. With no bundler facet the default stays the `\0` test, so nothing changes for the compiler's own unit tests.

  Six of the seven sites moved. The seventh strips a `\0` prefix so a user's SSR entry pattern can match and already tries the unstripped id too — it normalizes rather than asking about ownership, so it stays a byte test with a comment saying why.

  **Also fixes a blind spot in the guardrail meant to catch exactly this.** The facet-composition golden files report single-provider hooks from two hand-maintained arrays, and `hmrSelfAcceptCode` had been missing from both since it was added — so a facet-surface change was invisible to the artifact whose purpose is making facet-surface changes visible. Both hooks are listed now, with a note at the arrays.

  Adds `tests/fixtures/multiplex-assets.ts`, a multiplexed project with `virtualAssets` and a localized binary asset. It covers `emitFile` and `import.meta.ROLLUP_FILE_URL_*` under multiplex, which had no coverage at all.

- Updated dependencies [7779a8b]
- Updated dependencies [654569d]
- Updated dependencies [4c65c66]
- Updated dependencies [0926c2e]
  - @zintljs/compiler@0.1.0-alpha.14
  - zintljs@0.1.0-alpha.14

## 0.1.0-alpha.13

### Minor Changes

- bc1e1cf: Made the lab's dev server host-agnostic, so browser contracts can run against a build tool other than Vite.

  `BuildToolDriver` already covered the build side; the serving side was hardwired to Vite, which is why seventeen of twenty-one contracts could not see a second host. `DevServerDriver` is its counterpart — `LabDevServerHandle` describes a running server in the lab's terms, with `ViteDevServerDriver` holding the existing logic and a new `RsbuildDevServerDriver` alongside it. A manifest selects its driver the same way it already did for builds.

  Two collaborators stopped knowing what Vite is. `LabWebSocket` takes an intercept function rather than a `ViteDevServer`, with the `ws.send` patch moved into the Vite driver where host knowledge belongs; a host that cannot expose a hot-update channel simply omits it, rather than reporting "no packets" when it means "cannot see packets". `LabCompiler` identifies its compiler by project root rather than by a server object.

  **Also fixes: every Rspack build looked like production, including the dev server.** `nativeHostView` filled in the bundler and root from the host's native context but left `isDev` at its default of `false`, so a page served in development was compiled as a production build — `__ZINTL_DEV__` folded away, no settle beacon, no dev logging. It went unnoticed because the app was otherwise correct. Dev is now read from `compiler.options.mode`, this family's equivalent of Vite's `command === "serve"`.

- cdbcc14: Added an experimental `zintljs/rsbuild` entry point and pointed the contract suite at it, as the second phase of proposal 026. Rsbuild is a falsification harness, not a supported target: the deliverable is the leak ledger, not Rsbuild support.

  Zintl now builds a real SPA under Rsbuild, and all four project contracts (`build`, `graph`, `transform-dev`, `transform-prod`) pass against it. Notably, chunk-aligned catalogs survived the port with no Rspack-specific chunking code — the build emits one async chunk per non-source locale, each carrying only its own catalog, and ghost mode still omits the source locale entirely.

  Three portability defects were found and fixed, all of which also make the Vite path more explicit:

  - **The plugin now declares which ids its `load` hook handles** (`loadInclude`). On Rollup and Vite a `load` returning `undefined` is a free no-op; on Rspack, unplugin implements `load` as a module rule carrying `type: "javascript/auto"`, so an unfiltered hook claims every module and retypes it as JavaScript — which killed the build on the HTML template. The filter must be exact rather than generous: `.html` is claimed only under multiplex.

  - **The plugin now declares which ids its `transform` hook handles** (`transformInclude`), excluding HTML. Zintl transforms HTML through `transformIndexHtml`, never through `transform` — true of its design all along, but never stated, because on Vite HTML is not a module in the graph and so never arrived there.

  - **The host view is now derived from the host** rather than defaulting to `process.cwd()`. On a host with no config hook the default rooted the compiler at the monorepo root, discovering 217 boundaries across every example app and producing a manifest too large for `JSON.stringify`. `nativeHostView()` reads the root from unplugin's native build context.

  Two further leaks are reproduced and deliberately left open, both tracing to one cause — Zintl identifies a generated asset module by the source file's real path plus a query, so that module inherits an extension and an absolute path that mean something to the host. On Rspack, which types modules by extension, a localized `.txt` asset is classified as an asset and the JavaScript Zintl generated for it is base64-encoded into a `data:` URI, so the catalog ships a URI where translated text belongs — with a green build and green contracts. The committed snapshot records that broken output on purpose, as the tripwire for whoever fixes it. Snapshot sanitization also grew a rule for identifiers Rspack names after the absolute resource path.

  **Fixes SSR detection, which reported every Vite project as SSR.** `viteHostView` derived it as `Boolean(config.build?.ssr) || config.ssr !== undefined`, and on current Vite the second clause is always true — `ResolvedConfig.ssr` is always a populated object. So a vanilla SPA with no server anything resolved `ssr-wrapping` and `ssr-runtime`. Output stayed correct because `getRuntimeCode` gates the server store on `isSsr` a second time at codegen, but the capability flags were wrong.

  Deleting the clause outright is not the fix, and this was measured rather than assumed: it took down all ten SSR contract cases, because `build.ssr` is unset in dev, so the always-true clause had been keeping SSR alive there by accident. Detection is now answered per phase — `build.ssr` for builds, and for dev the shape of an SSR dev server (`middlewareMode`, or `appType: "custom"`, a signal `configureServerHook` already trusts).

  A consequence worth noting: the **client** build of an SSR app no longer resolves the SSR facets, which is the point — nothing about wrapping a server entry belongs in a browser bundle.

  Also adds the guardrail proposal 026 §8 asks for: a golden file per example application recording its resolved facet composition — the facet list in resolution order, every capability flag, the extraction surface, and which facets declare each single-provider hook versus what the merged view resolved. Composition was previously a live object graph full of functions that nothing ever printed, so a change to what `react-ssr` resolves to could only be noticed as behaviour. Two accompanying assertions: every example resolves exactly one bundler facet, and none resolves more than twelve facets.

  On the testing side, `BuildToolDriver` is now a real seam rather than a declared one: `LabPipeline` and `Lab` are typed on the interface instead of `ViteDriver`, a manifest can select its driver, and the bundler-free compile path is shared by both drivers unchanged. Adds `dirSource()` for checked-in project directories that should not join `examples/` and its build, lint and CI gates.

  No behaviour change on Vite.

### Patch Changes

- 7f68d92: Fixed inline contract fixtures racing each other across test workers.

  `copiedExampleSource` and `dirSource` materialize into `.tmp/runs/w<worker>/`, memoize per worker, and make `cleanup()` a deliberate no-op because pooled dev servers outlive the labs that created them. `fixtureSource` did none of that: every worker materialized the same `.tmp/fixtures/<id>`, wiped it on entry, and deleted it on teardown.

  That is a race with two ways to lose. One worker wipes the tree while another is mid-run against it, and one worker's cleanup deletes the tree whose pooled dev server another worker is still serving from. It is now worker-scoped, wiped once per worker rather than once per lab, with a no-op cleanup — the same model as the other two sources.

  This was the cause behind part of a long-standing symptom: at the committed `maxWorkers: 4` the contract suite failed roughly one test per run, a different one each time. Both fixture-backed manifests (`assets-basic`, `ssr-streaming`) were among the victims and stopped appearing after this change — measured across full runs, 2 failures in 3 before versus 1 in 8 after.

  The residual failure is a separate defect and is not addressed here: `hmr-hammer` occasionally sees four hot-update events for five writes, with every delivered update applied successfully. Diagnosis is recorded in `docs/spec/proposals/026-leak-ledger.md`.

- Updated dependencies [bc1e1cf]
- Updated dependencies [6926203]
- Updated dependencies [4df78f0]
- Updated dependencies [3dfd12b]
- Updated dependencies [6df4bc9]
- Updated dependencies [cdbcc14]
- Updated dependencies [49f299c]
  - zintljs@0.1.0-alpha.13
  - @zintljs/compiler@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [422bfac]
  - @zintljs/compiler@0.1.0-alpha.12
  - zintljs@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- 7c69554: Updated external dependencies:

  - @playwright/test@^1.62.1
  - vite-plus@0.2.7
  - vite@0.2.7

- Updated dependencies [43ebb95]
- Updated dependencies [7c69554]
- Updated dependencies [7c69554]
  - @zintljs/compiler@0.1.0-alpha.11
  - zintljs@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies [69fed7f]
- Updated dependencies [d3a1100]
- Updated dependencies [91662bd]
- Updated dependencies [2830f35]
- Updated dependencies [cc88b36]
- Updated dependencies [2af5252]
- Updated dependencies [553cdae]
- Updated dependencies [90dd704]
- Updated dependencies [91662bd]
- Updated dependencies [9c10e78]
- Updated dependencies [91662bd]
- Updated dependencies [8882138]
- Updated dependencies [c28c3aa]
- Updated dependencies [1e25c60]
  - @zintljs/compiler@0.1.0-alpha.10
  - zintljs@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies [60517d0]
  - @zintljs/compiler@0.1.0-alpha.9
  - zintljs@0.1.0-alpha.9

## 0.1.0-alpha.8

### Minor Changes

- b56004c: Add `copiedExampleSource`, unlocking parallel contract runs.

  `maxWorkers: 1` was not caution — it was load-bearing. Contracts mutate their project (`lab.fs.edit(adapter.headingFile)`), and several contracts target the _same_ file of the same example: `hmr`, `hmr-hammer`, `memory-leak`, and `performance-hmr` all edit `examples/react-basic/src/App.tsx`. Running four workers against the shared `examples/` tree produced **31 failures out of 72, no speedup, and a corrupted working tree**.

  `copiedExampleSource(dir)` gives each worker a private copy under `.tmp/runs/w<id>/`, removing the shared mutable state entirely.

  - **Per-worker, not per-test.** Dev servers are pooled by example name in module scope, so every lab for an example inside one worker must resolve to the same root; a per-test copy would leave the pooled server rooted at a directory the next test no longer uses.
  - **`node_modules` is a shallow symlink farm**, not a copy or a directory link — and the farm deliberately skips `.vite`, `.vite-temp`, and `.cache`. Anything the dev server _writes_ must be per-copy: linking Vite's dependency-optimization cache back to the shared `examples/` tree reintroduces cross-worker contention invisibly, since module resolution keeps working perfectly while four processes race the cache underneath it.
  - **Snapshot paths are normalized** back to `examples/<name>`, so output is byte-identical whichever source materialized it. Verified: zero snapshot churn after the switch.

  Measured on the same machine:

  |                       | Serial, shared   | 4 workers, copied |
  | --------------------- | ---------------- | ----------------- |
  | Duration              | 338s             | **140-155s**      |
  | Failures              | 0 (with retries) | 0                 |
  | Retries used          | 3                | **0**             |
  | `examples/` after run | mutated          | pristine          |

  Parallelism turned out to _reduce_ flakiness rather than add it — isolated projects remove cross-test interference that the shared tree was quietly causing.

  The HMR wall-clock budget now relaxes under `ZINTL_PARALLEL` as it already did under `CI`: with sibling workers competing for the machine, the number measures the hardware, not Zintl. `vpr bench` remains the real performance instrument.

- fe9fa30: Decouple contract tests from `examples/` and add inline fixtures.

  Contracts could only ever run against real applications on disk, which blocked whole categories of coverage: nothing in `examples/` exercises `assetsTarget`, and asking "does this break only under one framework, or one bundler?" would have meant authoring a full demo app per combination.

  The contract architecture already had the right shape — `Contract` declares `requires: Capability[]` and never names an example — so the coupling was a single hardcoded line, duplicated in `createLab` and `createProjectLab`:

  ```ts
  const root = join(MONOREPO_ROOT, "examples", opts.example);
  ```

  **`ProjectSource`** replaces it. A manifest now declares _where its project comes from_:

  - `exampleSource(dir)` — a directory under `examples/`, unchanged behaviour.
  - `fixtureSource({ id, files, zintlOptions })` — a project defined inline as a path → contents map, materialized under `.tmp/fixtures/` and given a generated `vite.config.ts` unless `files` supplies one.

  Fixtures materialize _inside_ the repo rather than the OS temp directory, so Node resolves `zintljs`, `vite`, and framework plugins by walking up to the root `node_modules`. `ZINTL_KEEP_FIXTURES=1` leaves them on disk for inspection.

  Materialization wipes first: a fixture is defined entirely by its `files` map, so leftovers would be invisible extra inputs. Teardown cleanup is best-effort by design — dev servers are pooled and outlive an individual lab, so one can flush catalogs and re-create part of the directory afterwards.

  **Breaking:** `ExampleManifest` is now `ProjectManifest` and requires a `source`. `LabOptions` / `ProjectLabOptions` take `source: ProjectSource` instead of `example: string`. Adds the `assets` capability.

### Patch Changes

- fe9fa30: Make contract assertions retry-capable and add a causal settle wait.

  Every flaky contract traced back to the same shape:

  ```ts
  await heading.waitFor({ state: "visible", timeout: 15000 });
  expect(await heading.textContent()).toContain(expected);
  ```

  `waitFor` resolves _immediately_ when the element is already visible showing the previous value, so the read races the update and the 15-second timeout never engages. It looks like waiting; it isn't. That produced `expected 'Memory Iteration 5' to contain 'Memory Iteration 6'` and `expected 'Hammer 4' to contain 'HMR Hammer works!'`.

  - Adds `lab.assert.textEventually(selector, expected)`, which polls the live DOM and reports the last value it saw so a genuine stall stays diagnosable. Migrated every occurrence of the old shape.
  - Adds `lab.waitForSettled()`, gating on the runtime's settle beacon rather than `networkidle` plus a fixed sleep. `LabFilesystem` gained a before-mutation hook so the baseline is captured _before_ the write it is waiting on, rather than racing it.
  - `ZINTL_STRICT_SETTLE=1` turns a missing or stalled beacon into a hard failure instead of a silent fallback. A degraded signal and a working one are otherwise indistinguishable, which is what made the previous heuristic impossible to trust.

  Also makes contract snapshots portable: bundler `#region` breadcrumbs for public-directory assets encode a `../` depth that tracks the absolute checkout path, so they differed between a local machine and a CI runner. Normalized to `<OUTSIDE_ROOT>/`, scoped to `#region` lines only — vendored sources legitimately contain relative paths that must not be rewritten.

  The HMR performance budget is now relaxed under `CI`. Wall-clock timing on a shared runner measures the runner, not Zintl; a tight budget there only teaches everyone to ignore the suite.

- 6214755: Eliminate contract flakiness: isolate the dep cache, drop retries, diagnose every failure.

  **Root cause.** `copiedExampleSource` rebuilt each worker's `node_modules` as a symlink farm over the original example's — and linked _every_ entry, including `.vite`. That is Vite's dependency-optimization cache, which the dev server **writes** to, so all four workers were writing into one shared directory under `examples/`.

  The failure mode is invisible by construction: module resolution keeps working perfectly while the cache underneath is raced by four processes. It explained every symptom collected — `svelte-basic` in three of four failures (heaviest optimization surface), 45-second hangs, `page.click` never finding a button because the app never rendered, and never the same test twice.

  The farm now skips `.vite`, `.vite-temp`, and `.cache`, so each copy owns what the server writes.

  Measured with `retry: 0`, five full runs each:

  |                  | Before  | After       |
  | ---------------- | ------- | ----------- |
  | Failures         | 4 / 360 | **0 / 360** |
  | Fully green runs | 2 of 5  | **5 of 5**  |
  | Duration spread  | 92-144s | 96-116s     |

  The tightened spread is corroborating: contention costs variance, not just correctness.

  **`retry: 0`.** A retry turns a flake into a green run, so the suite reports "passing" for a codebase that intermittently misbehaves. Every flake traced in this effort was a real defect — an assertion that could not retry, contention on a shared directory — and each was found only by reading past the checkmark to the `(retry x1)` beside it.

  **Failures now explain themselves.** Any contract failure attaches page state: HMR packet counts by type, the settle beacon value, console errors, body size, and which buttons actually exist. A `page.click` timeout previously reported only the locator it waited for, which cannot distinguish a missing element from an app that crashed and rendered nothing — different bugs, different fixes. Adds `LabWebSocket.recentPackets`, since captures must be started before the interesting moment and are useless after the fact.

  Known gap: a hard test timeout is raised outside the contract body, so no diagnosis is attached to those yet.

- fcd99bf: Fail when a snapshot exists for output that is no longer produced.

  `snapshotAll` iterates the files a build emitted _this_ run, so it can only check output that still exists. Stop emitting one — a chunk that disappears, a catalog no longer written — and its snapshot is simply never read. The suite stays green while output silently vanished, which is the one regression a snapshot test should be structurally incapable of missing.

  The prefix directory is now compared against the produced set, so the snapshot tree asserts the _shape_ of the output rather than the content of whatever survived. Each `snapshotAll` call owns its prefix exclusively (`<project>/dist-output`, `/dev-transforms`, `/prod-transforms`), so every file under it is expected to correspond to something produced.

  - Outside update mode an orphan fails with the list and a pointer to `-u`.
  - Under `-u` orphans are pruned, matching how vitest handles obsolete inline snapshots — the author is deliberately re-baselining.
  - If vitest ever stops exposing `testPath`, the guard **throws rather than skipping**. Silently skipping is precisely the failure it exists to prevent.

  Verified both directions: a planted ghost snapshot is caught (`Output disappeared: assets/__ghost_chunk.js`), `-u` prunes it, and no real snapshot is touched.

- Updated dependencies [fe9fa30]
- Updated dependencies [fcd99bf]
  - @zintljs/compiler@0.1.0-alpha.8
  - zintljs@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies
  - @zintljs/compiler@0.1.0-alpha.7
  - zintljs@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- 5be8d95: Moved facet resolution out of the compiler and into the host plugin, completing the separation the Concern-Faceted Architecture was aiming at. Knowledge now flows one way only: `extractor ← compiler (core) ← compiler/facets ← zintl (plugin)`. The compiler receives capabilities and executes them; it no longer selects, merges, validates or names a framework.

  **Compiler API.** `new ZintlCompiler(options)` now requires `options.capabilities`. `CompilerOptions.facets` and the internal `CompilerFacetInput` type are removed, and `resolveFacets` is no longer exported from `@zintljs/compiler`.

  ```ts
  // before
  new ZintlCompiler({ facets: [reactFacet(), viteFacet()] });

  // after
  import { resolveFacets } from "zintl/facets";
  new ZintlCompiler({
    capabilities: resolveFacets([...reactFacet(), viteFacet()]),
  });
  ```

  **Capability contract relocated to the compiler core.** All facet interfaces moved from `src/facet/types.ts` to `src/types/capabilities.ts` and are published from the package root. Renames: `ResolvedFacets` → `CompilerCapabilities`, `ResolvedCapabilities` → `CapabilityFlags`, `ResolvedFacetSystem` → `CompilerSystemView`. The bundle's boolean map is now reached as `capabilities.flags` rather than `capabilities.capabilities`.

  **Removed the `VITEST` facet injection.** The constructor silently pushed `htmlFacet()`, `assetsFacet()`, `vanillaFacet()` and `reactFacet()` whenever `VITEST=true` or `NODE_ENV=test`, so the compiler behaved differently under test than in production. This is why no compiler test ever passed a facet list. The facet set is now declared explicitly by the test harness.

  **Fixes uncovered by the move:**

  - **`ZintlFacet` was declared twice**, once in `dist/index.d.mts` and once in `dist/facet/index.d.mts`. Because `CompilerContext` reaches `IOManager` — a class with private fields — the two declarations were _nominally_ incompatible, which is what forced `as FacetsInput` casts on user-authored facets. `@zintljs/compiler/facets` now exports preset values only and imports the single canonical type declaration; the casts are no longer needed.
  - **The compiler hardcoded React.** `pipeline/resolve-imports.ts` injected `import { useSyncExternalStore } from "react"` for client components. Frameworks now declare this through the new `CodegenFacet.clientReactivityImports` field.
  - **`CatalogManager` and `GraphManager` hardcoded** `[".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html"]` when probing extensionless dependency ids; both now use the resolved extension list, exposed via `IOManager.resolvedExtensions`.
  - **`resolveTargets` returns a shared, memoized object** that the old resolver mutated in place, so two compilers with identical descriptors but different facet rules could clobber each other's extraction state. The new `compileExtractionState` export (also the seam that keeps the plugin free of an `@zintljs/extractor` dependency) builds the state immutably.
  - **`MergeState.hmrInjectionCode`** dropped the `hasAnchors` parameter that both `BundlerFacet` and the resolved view declare.

  **Removed two unreachable bundler hooks.** `BundlerFacet.isMultiplex` had no provider and was shadowed by `Context.getMultiplex`. `BundlerFacet.fanBuildInputs` was not merely unused but architecturally unreachable: MPA input fanning happens in the `config` hook, which runs before `configResolved` constructs the compiler, so a facet's copy could never be consulted.

  **Plugin.** `zintl/facets` now exports `resolveFacets`, plus `assembleFacets`, `autoFacets`, `flattenFacets`, `detectFrameworks`, `detectFrameworksOrFallback` and `FALLBACK_FRAMEWORK`. Framework detection and facet assembly moved out of `configResolved` into `facets/detect.ts` and `facets/assemble.ts`, leaving the hook as three visible steps: detect → assemble → resolve. The plugin's public `Options` now extends `Omit<CompilerOptions, "capabilities">`.

  **`@zintljs/testing`.** `ViteDriver.compile()` resolves capabilities the same way the plugin does instead of handing plugin-shaped options straight to the compiler. The contract snapshots consequently measure the production path for the first time — which revealed that `vue-basic` and `svelte-basic` had been asserting that Zintl performs _no_ transformation on Vue and Svelte components (the test-mode injection gave every example React facets), and that `react-basic`, `react-ssr` and `vanilla-spa-basic` were recorded with no bundler facet at all, so dev dynamic imports lacked their `/* @vite-ignore */` comment. 15 snapshots were regenerated against the correct output.

  **Enforcement.** Two architecture tests assert that no file under `src/index.ts`, `src/pipeline/`, `src/managers/` or `src/types/` imports from `./facet/**`, and that the compiler core names no framework or bundler. The 42 test files that require a resolved framework world moved to the plugin package, where resolution lives.

### Patch Changes

- Updated dependencies [2a07272]
- Updated dependencies [448dbc6]
- Updated dependencies [51261a9]
- Updated dependencies [7e02023]
- Updated dependencies [3fd61d3]
- Updated dependencies [4031237]
- Updated dependencies [5be8d95]
- Updated dependencies [1061058]
- Updated dependencies [448dbc6]
- Updated dependencies [a7f080f]
- Updated dependencies [fdda8fa]
- Updated dependencies [e1e504d]
- Updated dependencies [3fa4428]
- Updated dependencies [72acaa8]
  - @zintljs/compiler@0.1.0-alpha.6
  - zintl@0.1.0-alpha.6
