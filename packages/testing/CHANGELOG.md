# @zintljs/testing

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
