# @zintljs/testing

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
