# Proposal 029: The HMR Facet Seam, and Rsbuild as a Supported Target

**Status**: LANDED, WITH TWO OPEN ITEMS — `vpr ci` green (794 unit tests, 135 contract cases across 24 files, up from 122). The seam is built and Rsbuild builds and hot-updates against a real dev server. Two things are open and both are written down rather than smoothed over: the empty-render class is **half closed** (§4.2 — the in-flight interleaving is fixed and guarded, the synchronous one reproduces deterministically), and the contract harness currently converges this host via **page reload rather than hot update** (L-029), which is why `memory` is unclaimed and why `hmr`/`hmr-stress` prove less than they read.
**Date**: 2026-08-11
**Depends on**: [026-rsbuild-as-falsification-harness.md](026-rsbuild-as-falsification-harness.md), [027-completing-the-rsbuild-target.md](027-completing-the-rsbuild-target.md), [027-leak-ledger.md](027-leak-ledger.md), [028-rsbuild-support-status.md](028-rsbuild-support-status.md). This is the proposal 028 §6.4 said "is worth its own when someone picks it up."

## 0. What this is

028 refused to promote Rsbuild, and its reason was not a bug count. It was structural, and it named two questions:

| Question                                                           | 028's answer                                         |
| :----------------------------------------------------------------- | :--------------------------------------------------- |
| Does the _architecture_ have a seam for a second bundler's HMR?    | **No** — hardcoded to Vite inside a `vite: {}` block |
| Does _Rspack specifically_ hold the ordering guarantees HMR needs? | **Unknown** — instrumented (L-023), not established  |

This document answers both, builds the seam, and reports what the work found — including the two things neither 026 nor 027 nor 028 predicted, which are the parts worth reading.

## 1. Rspack does hold ZDB §7a's guarantees

028 §6.2 was right that this was unknown and right that it could not be assumed. It is now established by reading `@rspack/core@2.1.8`, `@rsbuild/core@2.1.10` and `unplugin@3.3.0` against ZDB §7a's Tier-2 table:

| Tier-2 requirement                                | Rspack / Rsbuild                                                                              |
| :------------------------------------------------ | :-------------------------------------------------------------------------------------------- |
| A hot-update hook carrying the changed file       | `compiler.hooks.watchRun` with `compiler.modifiedFiles` / `removedFiles`                      |
| **A monotonic, non-repeating per-event sequence** | `Watching.startTime`, set by Rspack per watch cycle                                           |
| **`read()` for the content of _that_ event**      | `compiler.inputFileSystem` — the cache this compilation will build from, purged per watch run |
| Module-graph access with per-module invalidation  | Not needed in this shape — see §3, which is the finding                                       |
| A per-module update token that reaches the client | Rspack's own `<chunk>.<hash>.hot-update.js`; Zintl contributes nothing                        |
| A server→client message channel                   | `RsbuildDevServer.sockWrite("full-reload", …)`, reached through `api.onBeforeStartDevServer`  |

The two load-bearing rows are both satisfied by facts about Rspack rather than by anything Zintl supplies, which is what §7a demands: _"do not emulate them with a counter of your own, because a second clock that can disagree with the bundler's is worse than no clock at all."_

`watchRun` is used rather than unplugin's `watchChange` (which taps `hooks.make`) for two reasons, both load-bearing. It fires **before** module building starts, so the manifest is re-extracted before the transform loader sees any module — otherwise the very compilation the edit triggered builds against stale strings. And it hands the whole changed **batch**, which is what makes one sequence per cycle correct rather than sloppy: those files are one event, and `invalidateForUpdate`'s custody (Axiom D3) keys on subject _and_ sequence, so sharing the number joins nothing that should not be joined.

## 2. The seam

028 §6.1 read `hooks/hmr.ts` and found it split cleanly in two — _deciding what changed_ (host-neutral compiler calls) and _telling the host's live module graph about it_ (Vite's `ModuleNode`/`ModuleGraph` vocabulary). That reading was correct and the split was mechanical:

| File                  | What it owns                                                                                          |
| :-------------------- | :---------------------------------------------------------------------------------------------------- |
| `hmr/types.ts`        | `HotUpdateEvent`, `HotUpdatePlan`, `BoundaryUpdate` — ids and strings, no bundler named               |
| `hmr/plan.ts`         | `classifyFile`, `computeHotUpdatePlan` — every `@zintljs/compiler` call, shared by both hosts         |
| `hmr/applier.ts`      | `HostUpdateApplier` — the seam                                                                        |
| `hmr/vite.ts`         | `ViteUpdateApplier` — today's module-graph surgery, moved unchanged including L-023's `repoint` trace |
| `hmr/rspack.ts`       | `RspackUpdateApplier`                                                                                 |
| `hooks/rspack-hmr.ts` | The `watchRun` tap, registered from the plugin's `rspack(compiler)` block                             |

**The applier is not a `BundlerFacet` hook**, and 028 §6.1's sketch (`BundlerFacet.applyInvalidation(affectedIds, hostGraph)`) would have been wrong on this point. A facet lives in `@zintljs/compiler`, and an applier is nothing _but_ bundler-specific — putting Vite's `ModuleGraph` in the compiler is exactly the leak the facet architecture exists to prevent. The precedent was already set by 027 §2.5's HTML seam: the host-neutral decision belongs to the compiler, and the code speaking a host's API belongs to `packages/zintl`, registered from that host's own escape hatch.

So the facet's half is a declaration, not an implementation: `BundlerFacet.hotUpdate?: boolean`, declared `true` by `viteFacet` and `rspackFacet`. That is the part core, the composition guardrail, and the registration fence can see. It is deliberately distinct from the existing `hmr` flag, and the composition golden files show them disagreeing — `rsbuild-spa` read `hmr: true, hotUpdate: false` before this work, which is precisely the state 028 described: acceptance codegen present, nothing to apply it.

**Nothing selects an applier.** Each host _contributes_ one — Vite's from `configureServerHook`, Rspack's from `rspack(compiler)` — so there is no `switch (bundler)` anywhere in the hot-update path. That is 026 §8's anti-pattern avoided by construction rather than by discipline.

## 3. The finding: Rspack needs to be _told the dependency_, not told to invalidate

This is the part no earlier proposal anticipated, and it is why 028 §6.1's sketch was shaped wrongly.

Vite's hot-update hook is a **request for a module list**: Zintl is handed an event and hands back the modules to update, so it must walk the graph and decide. Rspack asks nothing. It rebuilds whatever its own dependency graph says is stale — and a generated virtual module that declares no dependencies is never stale, no matter what any hook does.

So the equivalent work is not "invalidate these modules". It is "declare, once, what this generated catalog is derived from". `ZintlCompiler.getBoundaryInputs(boundaryId)` returns the boundary's source files plus its catalog paths; `generateVirtualModule` reports them as `watchedFiles`; `loadHook` forwards them to `addWatchFile`, which unplugin maps to `loaderContext.addDependency`. A source edit then rebuilds the entry _and_ the generated content and manager modules **in one compilation**, because Rspack already knows they are related.

The mechanism was already half-present and unused: `generateVirtualModule` has always returned `watchedFiles` and `loadHook` has always forwarded them — it returned `[]` for exactly the two module kinds that needed it.

The alternative was measured and rejected. `rspack.experiments.VirtualModulesPlugin.writeModule()` is the supported way to poke a virtual module's watcher, and it works — but calling it from `watchRun` lands the change in the **next** compilation, so it costs a second build per keystroke and shows the page a stale catalog in between. Declared dependencies cost neither.

`RspackUpdateApplier` is therefore almost empty, and that is the honest result rather than a gap: its `apply()` reports a count of zero because Zintl really did reach zero modules directly, and its only real work is `sendFullReload()` for the updates Rspack cannot patch.

### 3.1 A normalized id is not a path (and it did visible damage)

`boundaryOwnership` is keyed by `io.getNormalizedId`, which **strips the source extension** — `src/main.ts` is stored as `src/main`. Right for identity, which is content-based and must not move when a file is renamed `.ts` → `.tsx`. Wrong for anything handed to a filesystem.

Declaring `src/main` as a watched dependency did not fail quietly. Rspack accepted it, found no such file, and logged `building removed src/main` on every cycle — a watch on a path that can never exist, and a generated module that therefore never went stale. The symptom in the browser was subtle and much worse than a crash: the entry re-executed with the new key, the catalog it read was the stale one, the lookup missed, and — because Zintl has no source-locale fallback, by design — the heading rendered **empty**.

`ZintlCompiler.resolveSourcePath` probes `io.resolvedExtensions` (public "for callers that probe extensionless dep ids") and returns `undefined` rather than guessing, so a caller declares no dependency instead of a false one.

## 4. Verified

Hot updates on `examples/rsbuild-spa`, driven manually before trusting any suite, with a `globalThis` sentinel to prove no page reload occurred:

- Source-locale edit (`en`): heading updated, sentinel survived, settle beacon 4 → 11.
- Non-source-locale edit (`ar`, RTL, async catalog chunk): heading updated, sentinel survived, `dir="rtl"` preserved.
- The delivery bus behaved correctly throughout, including a `superseded` with reason `already loaded` — Axiom D1 doing its job on a second host.

One transient was observed during that pass and is now **explained and fixed** — see §4.2. It was the most valuable thing this proposal found, and it was not an Rsbuild defect.

### 4.2 The empty-render transient: a latent Vite defect, surfaced by a second host (L-028)

On one edit in four at `?lang=ar`, the heading rendered **empty** and stayed empty, while the ledger confirmed the fresh catalog `applied`.

Repeating the symptom did not reproduce it — twenty-two automated edits across two timing profiles, zero empties. Chasing a race by waiting for it again is how a defect gets filed as "flaky" and left, so the reproduction was built from the mechanism instead, and the mechanism is this:

| Path               | Started by                           | Records itself in                |
| :----------------- | :----------------------------------- | :------------------------------- |
| `registerLoader`   | a generated manager, as it evaluates | `pendingBoundaries` **only**     |
| `loadLazyBoundary` | `zintl()`                            | `pendingBoundaries` + `inFlight` |

`loadLazyBoundary` joins a concurrent load through `inFlight`, which `registerLoader` never wrote to — and it tested "already loaded" _before_ "already loading". A probe driving the real runtime (register a 250 ms loader, then immediately pull the same boundary) reported `inFlight: []` and a pull that returned in **0 ms** without the catalog already on its way.

The symptom is blankness rather than staleness because the entry re-executes with the _new_ key and looks it up in the _old_ catalog; with no source-locale fallback the miss renders `""`. The architecture turned a silent staleness bug into a visible one — and a permanent one, since nothing re-renders after the late `addCatalogs`.

**Vite never showed it, and the code said why.** The branch carried this comment, written long before:

> _"Known limitation: this also skips a refresh… It does not bite in development, where hot updates push catalogs straight into `addCatalogs` rather than coming back through here."_

True on Vite, which re-imports the whole chain with a fresh `?t=` so the content module applies before the entry re-renders. The clause "does not bite in development" was carrying an unstated "on Vite". Rspack re-executes the manager and the entry as independent modules, with the non-source-locale catalog behind a dynamic import, so the two genuinely interleave.

Fixed by publishing `registerLoader`'s async load in `inFlight` and checking `inFlight` before the already-loaded test. Guarded by `tests/contracts/delivery-refresh.contract.spec.ts`, which drives the interleaving on purpose rather than waiting for it: **five projects fail without the fix, five pass with it, and four of the five are Vite.** This was never an Rsbuild defect — only an Rsbuild sighting, which is precisely what 026 built this harness to produce.

**A second interleaving of the same class is still open.** The fix above closes the case where a load is _in flight_. It does not close the case where the entry re-executes and misses **before any load starts** — which is what happens on the source locale, whose manager carries its catalog inlined and synchronously. Reproduced deterministically (3/3) against a real dev server after clearing `node_modules/.zintl`: the catalog arrives (`catalogHasNewKey=true`, beacon 4 → 14, no reload) and the heading is still `""`, because `_t` had already missed and nothing re-renders afterwards.

Two candidate fixes were written and both **reverted unvalidated** rather than shipped: making `_t`'s browser branch consult the loader the way its server branch already does, and widening `getBoundaryInputs` to union the boundary graph with `boundaryOwnership`. Each is defensible on its own terms and neither changed the outcome, which means the mechanism is not yet understood well enough to fix. The next step is to establish _why_ the entry holds a stale manager at render time, not to try a third guess.

Until then the honest statement is that the empty-render class is **half closed**: the in-flight interleaving is fixed and permanently guarded; the synchronous one is reproducible and open.

### 4.1 What the contract suite then found

`rsbuild-spa` claims eleven capabilities and the suite runs 135 cases, at `retry: 0`. Three things surfaced that hand-testing had not, which is the argument for the contract layer in one paragraph:

- **An unparseable file wedged the whole pipeline.** `watchRun` is a `tapPromise`, so a rejection propagates into Rspack's own compilation — and the most ordinary input in dev is a file saved mid-keystroke, which the extractor cannot parse. `syntax-recovery` timed out at 45s because the watcher had stopped, so the _recovery_ edit was never compiled either. Zintl declining to update an unparseable file is correct; taking the host's build pipeline down with it is not.
- **The declared-dependency mechanism is wrong on Vite** — not redundant, actively harmful. Vite honours a declared dependency, so naming the catalog files there makes Zintl's own `flush()` writes re-enter as source changes; every catalog-writing contract on every Vite example timed out. Hence `BundlerFacet.dependencyInvalidation`, declared by `rspackFacet` and deliberately not by `viteFacet` (§3, and ZDB §7a's amended fourth row).
- **`ensureDiscovered`'s promise, not a flag** — L-027. A "have I discovered yet" boolean set before the `await` looks equivalent to one set after and is not, on a host whose `buildStart` is tapped to a _parallel_ hook.

**`memory` is deliberately unclaimed.** `memory-leak` drives twenty sequential edits and does not finish inside its 45s budget here, in isolation as well as under contention. That looks like throughput rather than a stall, and it is a cost of the mechanism rather than a defect: every edit on this host costs **two** compilations, because Zintl's `flush()` rewrites the catalog and the catalog is necessarily a declared dependency of the generated modules. Vite avoids the second pass because `handleHotUpdate` returns early on a Zintl-authored write; there is no equivalent lever once a host is doing its own dependency bookkeeping. Establishing throughput-vs-stall, and whether that second compilation can be suppressed, is the first thing to pick up after this proposal.

**`chaos` is unclaimed for a reason about the contract, not the host.** `chaos-boundary` renames the file holding the heading; here that file is the entry, which Rsbuild names in `rsbuild.config.mjs` rather than `index.html`, so renaming it restarts the dev server. Content-based boundary identity is covered by `boundary-graph` regardless.

## 5. Scope: what is deliberately _not_ supported

Decided rather than deferred, which is the difference from 028:

- **`multiplex` / MPA fan-out is not planned for Rspack.** The L-022 fence stays and is now documented as permanent rather than pending. Per-locale HTML fan-out is a Vite-only feature.
- **SSR is unbuilt and unexamined**, as in 026 §7 and 027 §6.
- **L-005** (Rspack's `emitFile` returning no reference id) remains unreproduced, and is now permanently blocked behind the multiplex path above — which means the design question it raises need not be answered at all unless that scope changes.
- **`performance` stays unclaimed.** `performance-size` filters responses by Vite-shaped URLs and its own header concedes it measures dev-wrapped modules inside a timing window. That contract needs rewriting against built output for _both_ hosts; it is a Vite-side contract-quality problem that happens to block a second host, and it is separable.

## 6. Ledger entries opened by this work

- **L-024** — the dev/build discovery gate was `!ctx.server`, a Vite-only field standing in for "have I discovered yet". On Rsbuild that meant a full project discovery pass per _compilation_.
- **L-025** — four hardcoded `import.meta.hot` literals in `hooks/resolve.ts`'s asset branches, past the facet. L-014 had dev-guarded one of them, which fixed the production leak and left the cause: dev-guarding Vite's API still emits Vite's API.
- **L-026** — `getBoundaryInputs` handing normalized ids to a filesystem (§3.1).
- **The `accept(cb)` asymmetry** — Vite's `import.meta.hot.accept(cb)` calls `cb(newModule)` after swapping the module in; Webpack's treats `cb` as an **error handler** and never calls it on success, re-executing the whole module body instead. `rspackFacet.hmrSelfAcceptCode` therefore ignores its `callbackBody` argument, and nothing is lost: both callers that pass a body do that work in the module body already. Emitting Vite's shape would have compiled, run, and silently registered catalog re-registration as an error handler that never fires.
