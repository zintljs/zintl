# zintl

## 0.1.0-alpha.15

### Minor Changes

- 3bdcea8: Framework detection no longer guesses React when it finds nothing (ledger L-034).

  `detectFrameworksOrFallback` returned `FALLBACK_FRAMEWORK` — `"react"` — for any project where neither the bundler plugin names nor `package.json` named a framework. That was not a neutral default: a project with no React dependency was assembled with React extraction and codegen, and because `reactCodegenFacet` is the only preset declaring `clientReactivityImports`, every project in existence reported having client reactivity. It also meant any runtime constraint attached to the React facet reached every framework-less project, which is why one previous attempt to mark React's entry re-execution unsafe had to be reverted.

  **What the guess was carrying was two extraction targets.** `obj:field:title` and `obj:field:text` were listed by `reactExtractionFacet` and not by `vanillaFacet`, so framework-less projects using those object fields had been depending on React extraction they never asked for. Both are plain object-field extraction with nothing React-specific about them, and they now live on the vanilla facet, which applies to every project.

  **Breaking:** `zintljs/facets` no longer exports `FALLBACK_FRAMEWORK` or `detectFrameworksOrFallback`. Use `detectFrameworks`, which returns an empty array when nothing matched — a real answer rather than a prompt for a guess. A project that uses a framework should declare it in `dependencies`/`devDependencies` or through its bundler plugin, both of which detection already reads.

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

- 391f5ef: Rsbuild is a supported target.

  `zintljs/rsbuild` now carries a promise rather than a disclaimer: single-page applications, in
  production builds and in `rsbuild dev`, with React and vanilla JavaScript — chunk-aligned catalogs,
  ghost mode, localized assets, per-locale `<html lang>`/`dir`, and hot updates. Vue and Svelte are
  untested on this host rather than unsupported. SSR and per-locale HTML fan-out (`multiplex`) are
  Vite-only, and combining `multiplex` with Rsbuild fails your build with a clear error rather than
  doing nothing quietly.

  Two fixes made the difference, and both were latent rather than new.

  The hot-update hook Zintl registers on Rspack **was never actually being called**. unplugin gates its
  `rspack` escape hatch on `meta.framework === "rspack"`, and its Rsbuild target sets `"rsbuild"`, so the
  tap was dead code and Rsbuild had been hot-updating through the ordinary transform path all along. It
  is now registered from the plugin's own Rsbuild block.

  And the catalog flush was fire-and-forget — correct on Vite, where the browser's update comes from the
  compiler's memory, and wrong on Rspack, where the generated modules declare the catalog files as
  dependencies and Rspack builds them by reading those files. A compilation could therefore be built from
  a catalog that had not been written yet. The flush is now awaited once per watch cycle, which made the
  dev loop measurably _faster_: the late write had been forcing a second compilation per edit.

### Patch Changes

- 8d8f942: Fixed client reactivity never being injected into plain React apps (ledger L-032), which also fixes the empty-render defect on Rspack (L-030) for framework apps.

  **The gate asked the wrong question.** `useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion)` was injected only into files where `observation.isClientComponent` held — and that is literally `code.includes('"use client"')`, a React Server Components directive. A plain React SPA never writes it, so no component in `react-basic`, `react-ssr` or a React app on any host subscribed to the store at all. Exactly one file in this repository carried the directive.

  `RuntimeFacet.serverComponents` now decides it, declared `true` only by the Next.js runtime facet. Where a framework separates server components from client ones, the directive still gates injection; everywhere else every component is a client component. Both the import gate and the injection gate move together, so a file cannot import a hook it never calls.

  **A second defect was hidden behind the first.** `registerComponentFunction` marked the outermost function containing _any_ JSX, with no name check — so a `bootstrap()` that merely calls `createRoot(el).render(<App />)` was treated as a component. Enabling the gate turned that into `Invalid hook call` and a blank page. It now requires a capitalised name, from the declaration or the binding an expression is assigned to, which is React's own rule; an unnamed function is not marked, because failing to subscribe degrades a repaint while a hook in a non-component breaks the app.

  **Why this mattered beyond React.** On Vite the missing subscription had no visible consequence — its module ordering makes the first render correct, so nothing ever needed repainting. On Rspack a catalog can arrive after the render, and with no subscriber the page stayed permanently blank. `examples/rsbuild-react` now claims `hmr`.

  Generated React output changes: components gain a `useSyncExternalStore` call and the corresponding imports.

- 778e1d5: Fixed two defects on the dev path that a Vite-only host could not distinguish (ledger L-024, L-025).

  **L-024 — the discovery gate was a Vite artifact.** `hooks/build.ts` decided whether to run the full `discover()` pass with `if (!ctx.server)`. `ctx.server` is assigned only by Vite's `configureServer`, so the test read "am I in a Vite dev server" while standing in for "am I building" — indistinguishable on Vite, where the two agree in `dev`, `build` and `preview` alike. On Rsbuild nothing assigns it, and `buildStart` is tapped to `compiler.hooks.make`, which fires once per _compilation_ — so every incremental rebuild re-discovered the entire project before building a single module. Now `if (!ctx.compiler.isDev)`, which is truthful on both hosts as of L-020's `hostHints` merge.

  **L-025 — four hardcoded `import.meta.hot` literals bypassed the bundler facet.** The `?raw` / `?zintl-raw` localized-asset branches in `hooks/resolve.ts` wrote Vite's HMR API out as string literals, the same class of leak L-014/L-015/L-016 found in the codegen hooks and `rspackFacet` exists to stop. L-014 had already dev-guarded one of these sites, which fixed the production leak while leaving the cause in place: dev-guarding Vite's API still emits Vite's API. All four now route through `_resolved.system.hmrSelfAcceptCode`. `viteFacet`'s output is byte-identical to the literals it replaces, so the change is inert on Vite; on Rspack it stops emitting a reference the host never defines.

- 9604cbd: Fenced ledger L-022: combining `multiplex: true` with a bundler that has no HTML fan-out support now fails fast with a clear `[Zintl] Multiplex is not supported...` error, instead of an opaque `html-rspack-plugin` loader-chain crash on Rspack/Rsbuild.

  Under multiplex (per-locale HTML fan-out), `loadIncludeHook` claims `.html` on the assumption that `loadHook` will serve it — true on Vite, where the fan-out is implemented, and fatal on Rspack: unplugin retypes the claimed template as `javascript/auto`, and the build dies inside `html-rspack-plugin`'s child compilation parsing `<!doctype html>` as JS.

  `BundlerFacet` gains `htmlFanOut?: boolean` — declared `true` on `viteFacet`, deliberately left undeclared on `rspackFacet` — following the same "ask the facet, don't test the bundler string" pattern ledger L-004 established for `isVirtualId`. `host.ts::ensureCompiler` checks the resolved capability against `ctx.getMultiplex()` before constructing the compiler, so the fence fires once, before any module resolution, on every host.

  The real HTML fan-out for Rspack remains undesigned and out of scope (026 §7, 027 §6) — this only replaces a crash with a loud, actionable error. Verified against a real `zintljs/rsbuild` build via a new fixture and contract (`tests/fixtures/multiplex-rsbuild-fence.ts`, `tests/contracts/multiplex-fence.contract.spec.ts`, capability `"multiplex-fenced"`).

- 73c430a: Added a silent, always-on diagnostic trace for `handleHotUpdateHook` (`Context.hmrTrace`), pursuing ledger L-023 / proposal 027 §2.4's HMR ordering defect. Records every hook invocation, both early-return guards, every `mod.file` reassignment the fallback scan performs, and the return outcome — a ring buffer, never a `console.*` call, so it cannot perturb the timing it's observing.

  The first attempt at this used `DEBUG`-gated `vLogger.debug` calls, and testing surfaced a real, separate finding: enabling the exact `DEBUG=zintl:vite` scope needed to see them suppresses `handleHotUpdateHook`'s invocation entirely (measured: 32-40 invocations per run with `DEBUG` unset, 0 across repeated runs with that scope enabled). Recorded in the ledger rather than chased further; the ring buffer routes around it by never printing.

  Surfaced through the test harness via `LabCompiler.hmrTrace` (reusing the existing `globalThis.__zintl_active_contexts` bridge `LabCompiler.instance` already relied on) and automatically included in `describeStall()`'s failure diagnosis, alongside the existing wire-, runtime-, and compiler-ledger sections.

  A ten-run full-suite reproduction pass caught zero `hmr-hammer` failures and zero evidence for the `mod.file`-repointing hypothesis this instrumentation was built to test — inconclusive at this sample size, and the instrumentation is left in place for a future, larger attempt. The pass did catch an adjacent failure (`memory-leak` on `react-basic`) pointing at a different, already-named, still-open item: proposal 024's `entryReexecutionSafe`/React `createRoot` gap. Full writeup in `docs/spec/proposals/027-leak-ledger.md`, L-023.

- 8d7ff57: Stop a hot update from double-mounting a React entry.

  Two defects produced one symptom, and both are fixed.

  A sibling stylesheet was being repointed onto its component in Vite's module graph: the fallback scan
  that matches modules to boundaries compares with file extensions stripped, so `src/App.css` matched
  `src/App.tsx` and went out as part of that boundary's update. An extension-blind match now requires
  the candidate to be a file Zintl extracts from at all. This confirms and closes a hypothesis open
  since proposal 027 §2.4.

  And React now declares, through the new `reactRuntimeFacet`, that re-running its entry is not safe —
  `createRoot()` on a container it already owns mounts a second root over the first rather than
  replacing it. Svelte has declared the same thing since the field existed; React could not until
  framework detection stopped guessing React for projects that never mention it.

  Measured on `react-basic` across sixty edits: six double mounts before, one after. No cost on Rspack,
  verified against a real `rsbuild dev` — hot updates there are unchanged.

- 0d90ac3: Say what `zintljs/rsbuild` actually is.

  The entry point has been a supported way to build a single-page app since proposal 029, in production
  builds and in dev. Its own module doc still said the opposite — "not a supported target", "hot updates
  not attempted" — which is the text that shows on hover, and both READMEs still described Zintl as
  Vite-only.

  All of it now reflects the code: Rsbuild sits beside Vite as an optional peer dependency, `multiplex`
  and SSR are named as Vite-only rather than left to be discovered, and the dev-time behaviour is
  described by its rule — an app whose components re-read the catalog updates in place, one without
  them reloads — instead of by whichever example was measured last.

  The publish smoke gate also runs against `zintljs/rsbuild` now, not just `zintljs/vite`, so a
  consumer's `npm install` of the Rsbuild entry point is exercised before a release rather than after.

- Updated dependencies [8d8f942]
- Updated dependencies [97b4a72]
- Updated dependencies [9604cbd]
- Updated dependencies [3bdcea8]
- Updated dependencies [b5b5a3d]
- Updated dependencies [8d4c472]
- Updated dependencies [8d7ff57]
- Updated dependencies [778e1d5]
- Updated dependencies [391f5ef]
  - @zintljs/compiler@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- 7779a8b: Gave the HTML projection a host-neutral path, so `<html lang>`/`dir`, `<title>` and `<meta description>` follow the locale on Rsbuild as they do on Vite.

  `compiler.transformHtml()` was always host-neutral; what was not is the only thing that ever called it — Vite's `transformIndexHtml`, which lives in the plugin's `vite` block and which unplugin drops on every other target. Rsbuild's `api.modifyHTML` has the same shape, so this is wiring rather than a second implementation, routed from the plugin's `rsbuild` block. Deliberately **not** a `BundlerFacet` hook: `ContentFacet.transformHtml` already exists and _is_ the projection, so a bundler hook of the same name beside it would reproduce a naming collision this codebase has been bitten by before — and registering `modifyHTML` is plugin work that a facet, being data and string-returning functions, cannot do.

  **Two things had to be solved that a straight wiring would not have caught.**

  _Identity._ Rsbuild hands the hook an output filename (`index.html`, relative to `dist`) where Vite hands an absolute source path. The projection re-reads the source on a cache miss and computes sink offsets against it, so passing the output name through produces a blank page. It is now inverted through `htmlPaths` and `html.template` back to the source id — and when any step yields nothing, which happens for real when Rsbuild uses its built-in template, it warns and declines rather than silently doing nothing.

  _The boundary link._ Zintl learns which scripts a document loads by reading `<script src>` from markup, and turns them into the document's dependencies — which is how a page reaches a trust anchor and becomes a boundary at all. An Rsbuild template names no scripts: the entry is injected at build time from `source.entry`, so the association lives in the build config. With nothing to read, no HTML document reached a boundary on this host, no catalog was ever scaffolded for one, and the direction map came out empty.

  `CompilerOptions.htmlEntries` is the new declaration — keyed by html id, valued with source ids, unioned with whatever the markup says and empty on every host whose templates name their own scripts. It updates both `htmlProjection.scripts` and `dependencies`, because the extractor derives the second from the first _during_ extraction and afterwards they are two separate facts.

  **Also generalised**: the `locale-switch` contract asserted a request URL containing `virtual:zintl/content/<locale>/`, which is Vite's virtual-module spelling — an Rspack build emits catalogs as ordinary hashed async chunks. The question the contract asks is host-neutral; only the spelling is not, so an optional `LocaleSwitchAdapter.isCatalogRequest` holds the per-project answer and defaults to the Vite form.

### Patch Changes

- 654569d: Made `<html dir>` follow the active locale on any host, and fixed two defects that stopped it following reliably on Vite.

  Direction used to reach the document only through the HTML projection, which Zintl injects via `transformIndexHtml` — a Vite hook that unplugin drops everywhere else. The runtime had no direction data of its own and deliberately set only `lang`.

  It now has the data. `ContentFacet.rtlLocales` is a new hook, unioned by `ZintlCompiler.getRtlLocales()` and substituted into the generated runtime as a literal array, so the store can set `dir` wherever it already sets `lang`. Core learns nothing about direction or about RTL languages: it merges string arrays that facets return. The HTML facet answers by reading the `dir` field already written into every HTML catalog — so this is one derivation moved to where two consumers can share it, not a new source of truth, and there is no list of RTL languages anywhere in the runtime.

  **Two defects fixed on the supported path**, which together explain why adding an HTML catalog to a page could stop `lang` updating:

  - The projection's `apply()` returned early when `lang` already matched the target locale — but it owns `dir` as well, so anything that set `lang` first permanently locked `dir` out with no way to correct it. Every statement in that function is an idempotent assignment, so the guard bought nothing.
  - The store's own attribute handling was an `else` branch behind `window.__zintlApplyHtml`. The projection installs that function unconditionally but writes `dir` only when the project has an RTL locale, so on every other project it took ownership of the document and then declined to finish the job, silently suppressing the fallback. The two now run in sequence: the store owns `lang` and `dir`, the projection owns the document-specific title, description and body deltas.

  `dir` is written only when the project actually has direction data. Empty means "this project never spoke about direction", and asserting `"ltr"` there would start writing an attribute onto documents that never had one.

  **Removed: the dead `sourceLocale` field on `I18nStore`.** It was written by a build-time substitution and never read — the only occurrence in the whole runtime was its own declaration — and it shipped in every production bundle. Its substitution was also the fragile kind: a regex matching a TypeScript class-field default, one `readonly` keyword or formatter change away from silently matching nothing. `getRuntimeCode` drops its `sourceLocale` parameter and gains `rtlLocales`, which uses the same word-boundary sentinel mechanism as `__ZINTL_DEV__`.

- 4c65c66: Fixed development mode never being detected under Rsbuild, which stripped the dev-only runtime from every page the Rsbuild dev server served.

  Dev detection on this family read `compiler.options.mode === "development"`. That is correct for webpack and for raw Rspack, where the user sets it — but **Rsbuild leaves `mode` at `"none"` for `dev`, `build` and `preview` alike**, because it drives optimisation from its own configuration rather than from webpack's mode presets. So `isDev` was `false` on the dev server, the runtime was generated with `__ZINTL_DEV__` folded to `false`, and the settle beacon and delivery ledger compiled away.

  Nothing looked broken, which is why it survived: the page rendered, translated, and switched locale correctly. Only the diagnostics were gone — so every failure investigated on this host reported `settle beacon: ABSENT — no Zintl runtime on the page` about a page whose runtime was present and working, and the misdiagnosis was then recorded as a finding.

  Dev-ness is a fact the **Rsbuild** layer owns and the Rspack layer cannot see, so it is now asked for where it lives: the plugin grows an `rsbuild` block — structurally the twin of its existing `vite` block — reading `api.context.action`, which Rsbuild documents as `"dev"` for both `rsbuild dev` and `rsbuild.startDevServer()`. `"preview"` is deliberately not dev, since it serves a production build. `Context.hostHints` carries the answer to compiler construction, which merges it over the view derived from the native build context.

  That split is the general shape rather than a special case: a host can be a **stack**, and unplugin hands a plugin the _inner_ bundler's context under both. Hints complete a native view with facts the inner layer could not supply; they never override one it did.

  No behaviour change on Vite, and none on Rsbuild production builds.

- Updated dependencies [7779a8b]
- Updated dependencies [654569d]
- Updated dependencies [0926c2e]
  - @zintljs/compiler@0.1.0-alpha.14

## 0.1.0-alpha.13

### Minor Changes

- 4df78f0: Facets now decide for themselves when they apply, instead of being selected by a table in the plugin. This is the self-activation inversion proposal 026 was sequenced to inform, and it uses that spike's leak ledger as its input.

  `autoFacets` no longer chooses. Every built-in facet is offered as a candidate and each answers for itself: the framework switch, `if (ssr && !isNext)` and `if (!isNext)` are gone, and the decisions they encoded are declarations on the facets that own them. Adding a framework now means shipping a facet that knows its own condition rather than editing core.

  **A facet declares its condition as data**, not as a predicate:

  ```ts
  { name: "react-codegen", when: { framework: "react" } }
  ```

  `when` supports `framework`, `bundler`, `dependency`, `ssr` and `dev`; all present fields must hold, and an omitted `when` means unconditional with no check performed. An optional `activate(ctx)` escape hatch covers what a descriptor cannot express. The reason for preferring data is the trace: a predicate can only report _that_ it said no, where a descriptor reports `when.framework=vue ✗ (detected: react, nextjs)`.

  **Activation is not a boolean.** `provides` / `supersedes` / `conflicts` let one facet replace another — Next.js supersedes the generic SSR wrapper and client-SPA facets, targeting a provided capability rather than a hardcoded name. That was previously an `if (!isNext)` whose reason lived in a comment. `conflicts` is the hard-error case for pairs with no sensible winner.

  **Every decision is explained.** Activation emits a trace covering active and inactive facets alike, and it is committed to the per-example composition golden files, so "why is React support off?" is answerable from a text file.

  **Adds an experimental `rspackFacet()`**, activated by `when: { bundler: "rspack" }`. It is as much about what it prevents: with no bundler facet active, the compiler falls back to a snippet that emits `import.meta.hot` — Vite's API — into any host, and five Rspack dev-transform snapshots carried it. Its `hmrInjectionCode` deliberately emits the HMR token and **no acceptance call**, because Rspack uses `module.hot` and ZDB §7a forbids shipping hot updates on a host whose ordering guarantees have not been established. Returning a function at all is the point: it takes core off the wrong fallback.

  **Routes generated modules through the facet seam.** The compiler hardcoded `import.meta.hot` when emitting catalog and manager modules and consulted no facet, so every host received Vite's HMR API for Zintl's own generated code. A new `BundlerFacet.hmrSelfAcceptCode(callbackBody?)` covers it — distinct from `hmrInjectionCode`, which decorates source files and must reason about whether re-executing an entry is safe; a generated module is always safe to replace but sometimes needs a callback body, which the source-file hook cannot express. With no bundler facet supplying it, nothing is emitted.

  **Fixes `import.meta.hot` reaching production bundles.** The `?raw` asset proxy emitted an unguarded `import.meta.hot.accept()`, where its sibling branch was dev-guarded. This was invisible on Vite, which substitutes `import.meta.hot` with `undefined` in production so the branch folds — a host guarantee Zintl was silently relying on. Rspack does not substitute, so it shipped. Now dev-guarded; no change to Vite output.

  **Bundler facets are now host-conditional.** `viteFacet` declares `when: { bundler: "vite" }` rather than being appended to every project. This fixes a real leak: Rspack builds were being handed `import(/* @vite-ignore */ …)`, a Vite annotation in output no Vite ever reads. Bundler facets remain unconditional _candidates_ — opting out of the built-in set should not silently strip host integration — but being a candidate is no longer the same as being active.

  **Option surface — breaking.** `facets: ["auto", …]` becomes `facets: ["builtins", …]`, and `"auto"` is **removed rather than aliased**: it is now a type error. The sentinel was misnamed — it reads as "be automatic", but automatic is no longer optional; what it selects is which _set_ of facets is on the table. Zintl is pre-1.0 with no users to migrate, and a silent second spelling is a migration nobody ever finishes.

  New `excludeFacet(name)` drops a single builtin, which previously required listing every facet by hand and keeping that list in sync.

  Composition is unchanged for every existing example on Vite.

- 3dfd12b: Moved compiler construction and multiplex propagation off the bundler's plugin context, so both are answerable without a Rollup-shaped host. This is the first phase of proposal 026, which uses a second build tool as a falsification harness for the claim that the compiler is bundler-agnostic.

  - **Compiler construction is no longer a Vite-only hook.** `detect → assemble → resolve → construct` moved into a new `host.ts` behind an idempotent `ensureCompiler(ctx, host)`, keyed on a small `BundlerHostView` (`root`, `isDev`, `isSsr`, `pluginNames`, `logLevel`). `configResolved` now only translates Vite's `ResolvedConfig` into that view; `buildStart`, `resolveId`, `load` and `transform` call it defensively. Previously the compiler was assigned in `configResolved` alone — a hook unplugin drops entirely on every non-Vite target, so the plugin would load and then fail on `undefined` at the first resolution.

  - **Multiplex propagation asks the graph instead of walking it.** The 58-line translation-neutrality closure inside `resolveId` — which reached into `metadataGraph`, `internalManifest` and `dependencyGraph` one import edge at a time — is replaced by `ZintlCompiler.isTranslationNeutral()`, backed by a new `GraphManager.hasTranslatableContent()`. The knowledge was always the compiler's; the resolver was rediscovering it per edge while consulting the very structure that had the answer.

  - **Deleted the static extension allow-list** that gated multiplex propagation (`js`, `jsx`, `ts`, `tsx`, `md`, `txt`, `vue`, `svelte`). It was app-agnostic — a Vue-only project paid for `.svelte`, and a facet contributing a new extension was silently skipped — and it was answering "might this file contain strings" where the graph can answer "is this module inside translated content". Nothing replaced it.

  Note that `hasTranslatableContent` is deliberately **not** `leadsToBoundary`: the latter asks whether a file reaches a trust anchor (locale ownership), while multiplexing needs to know whether it reaches translatable content (payload). A component holding strings but declaring no anchor answers differently to the two, so reusing the existing method would have silently dropped its translations.

  No behaviour change on Vite.

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

- bc1e1cf: Made the lab's dev server host-agnostic, so browser contracts can run against a build tool other than Vite.

  `BuildToolDriver` already covered the build side; the serving side was hardwired to Vite, which is why seventeen of twenty-one contracts could not see a second host. `DevServerDriver` is its counterpart — `LabDevServerHandle` describes a running server in the lab's terms, with `ViteDevServerDriver` holding the existing logic and a new `RsbuildDevServerDriver` alongside it. A manifest selects its driver the same way it already did for builds.

  Two collaborators stopped knowing what Vite is. `LabWebSocket` takes an intercept function rather than a `ViteDevServer`, with the `ws.send` patch moved into the Vite driver where host knowledge belongs; a host that cannot expose a hot-update channel simply omits it, rather than reporting "no packets" when it means "cannot see packets". `LabCompiler` identifies its compiler by project root rather than by a server object.

  **Also fixes: every Rspack build looked like production, including the dev server.** `nativeHostView` filled in the bundler and root from the host's native context but left `isDev` at its default of `false`, so a page served in development was compiled as a production build — `__ZINTL_DEV__` folded away, no settle beacon, no dev logging. It went unnoticed because the app was otherwise correct. Dev is now read from `compiler.options.mode`, this family's equivalent of Vite's `command === "serve"`.

- 6df4bc9: Fixed localized text assets shipping a `data:` URI instead of their translation on bundlers that type modules by file extension.

  Zintl turns a `.md`/`.txt` import carrying `?raw` or `?zintl-raw` into a JavaScript module, but kept the source path as the module id — so the module still looked like a text file. On Rollup and Vite that is harmless, because module type follows from _who loaded the module_. On Rspack it is a property of the resource's extension, decided before any plugin speaks: it classified `about.txt?raw` as an asset and base64-encoded the JavaScript into a `data:text/plain` URI, which the catalog then shipped where the translated text belonged. The build succeeded and every contract passed.

  These ids now resolve to an extension-free virtual id, decoded again at load so every existing branch is unchanged. The fix is in id spelling — the plugin's own responsibility — rather than in a bundler-specific escape hatch that rewrote module rules.

  Two boundaries worth knowing:

  - The encoding is base64url, not `encodeURIComponent`. Percent-encoding preserves `.`, so the encoded id still ended in `.txt`, and unplugin materialises a virtual module as a real file whose _name_ is that id — reproducing the same misclassification one layer down.
  - The rewrite is applied _after_ multiplex resolution picks a per-locale file, not before it. Rewriting the identity first short-circuits that choice and hands every locale the source text.

  The encoding covers the whole id, query included, so decoding reproduces byte-identical input. That is what lets the same rewrite be applied at each of the five places resolution can land on such a file without any downstream branch knowing it happened.

  No change to Vite output.

- Updated dependencies [6926203]
- Updated dependencies [4df78f0]
- Updated dependencies [3dfd12b]
- Updated dependencies [49f299c]
  - @zintljs/compiler@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- 422bfac: Beta-prep pass on the compiler: dead code removed, `any` usage cut from 252 to 141 occurrences (all internal — the compiler's public surface is now fully typed except one genuinely-dynamic disk-read catalog value).

  **Dead/redundant code removed:**

  - Leftover commented-out debug scaffolding in `ZintlCompiler`.
  - A duplicated HMR self-accept snippet (the no-facet fallback re-implemented, and slightly diverged from, `viteFacet()`'s own logic) — consolidated into one shared helper.
  - A redundant `pipeline/types.ts` barrel that re-exported the exact same thing as `src/types.ts`.
  - ~16 independent copies of the Windows-path-normalization idiom (`.replace(/\\/g, "/")`) and 3 copies of the monorepo-example-detection check, each consolidated into one shared utility.
  - Pruned unused public exports with zero consumers anywhere in the monorepo: `DeliveryBus`, `DeliveryBusOptions`, `DeliveryChannel`, `DeliveryLedgerEntry`, `DeliveryOutcome`, `Envelope`, `TerminalOutcome`, a duplicate `ZintlLogger` re-export, and `similarity`/`sortObjectKeys`/`compareStrings`. Implementations are untouched — only the public re-export is gone, since nothing outside the package's own internals imported them by name.

  **`any` → real types**, working from the root cause outward (`MessageManager`'s untyped graph/manifest fields cascaded `any` through `GraphManager`, `CatalogManager`, `CompilerContext`, and `ZintlCompiler` itself) rather than annotating each call site independently:

  - Fixed `types/graph.ts`'s `DependencyGraph` alias, which had been defined against the wrong upstream type (`@zintljs/extractor`'s `BoundaryDep`, optional `bindings`) when every real consumer needs the compiler's own `ObservedDependency` (required `bindings`) — a latent type-definition bug the `any` had been quietly hiding.
  - `MessageManager`, `GraphManager`, `CatalogManager`, `IOManager`, `CompilerContext`, and `ZintlCompiler` now use the domain vocabulary that already existed (`Manifest`, `DependencyGraph`, `MetadataGraph`, `BoundaryGraph`, `ChunkGraph`, `CompilerContext`, `CatalogFormatContext`, `ZintlLogger`, magic-string's `SourceMap`) instead of `any`.
  - Facet hooks with genuinely per-facet dynamic state (`ContentFacet.setup`/`getStateToSave`/`getManagerInstance`) now return `unknown` rather than `any` — honest about being untyped without inventing a new abstraction.
  - `ZintlCompiler.assets`/`.html` (typed `unknown`, correctly — the compiler core cannot know about specific facets) surfaced ~40 call sites in `zintljs` that were relying on `any`'s silence to treat them as concretely-shaped objects. Exported the two previously-private manager classes (`AssetManager`, `HtmlManager`) as types from `@zintljs/compiler/facets` so those call sites can narrow honestly instead.

  Remaining `any` usage is concentrated in `pipeline/*` internals, `runtime/*` (served as text to the browser, not part of the public `exports` map), `facet/presets/{html,assets}.ts`, and a handful of genuinely-dynamic disk-read catalog/schema values with no existing type to reuse — left as a deliberate follow-up rather than inventing new types under this pass.

- Updated dependencies [422bfac]
  - @zintljs/compiler@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- 7c69554: Updated external dependencies:

  - vite-plus@0.2.7

- Updated dependencies [43ebb95]
- Updated dependencies [7c69554]
  - @zintljs/compiler@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- cc88b36: Let frameworks declare whether re-running an entry is safe, and fix the Svelte double-mount.

  Zintl injects `import.meta.hot.accept()` into files that declare a trust anchor — which are the files that mount. Accepting tells the bundler to re-execute the module, and the injected callback only logged, so it claimed the update was handled while the mount ran a second time.

  Whether that matters is a property of the framework. Assigning `innerHTML` replaces. Svelte's `mount()` appends a second copy. `chaos-boundary` reproduces the Svelte case exactly: the page renders twice, 14,665 bytes instead of ~7,300, the locale switcher appearing twice, and the heading selector reading the stale copy.

  Both blanket answers were measured, and each is wrong for the other half:

  - **Always self-accept** double-mounts Svelte on an entry rewrite.
  - **Never self-accept** turns every entry edit into a full page reload, which times out `memory-leak` on `vanilla-spa-basic` — twenty sequential entry edits become twenty reloads. (An earlier attempt used `import.meta.hot.invalidate()`, the same thing by another route: it regressed `hmr-hammer` on every project and took the suite from ~75 s to ~127 s.)

  So the framework decides, through `RuntimeFacet.entryReexecutionSafe`. `svelteRuntimeFacet` declares `false` and joins the compound preset; everything else keeps the self-accept and keeps its hot updates hot. The flag merges **pessimistically** — one facet declaring re-execution unsafe decides it for the project, because a project containing any non-replayable mount has one, and OR-ing these the usual way would let a safe facet vote away a hazard another facet reported. Absent means safe: the conservative direction is the one that keeps hot updates working, and a framework needing the other has to say so.

  **A trap worth knowing before adding any other runtime claim.** React was marked unsafe first — `createRoot()` does throw on a container it already owns, which is what proposal 024 §1.3 recorded. It had to be reverted, because **`FALLBACK_FRAMEWORK` is `"react"`**: a project where no framework is detected is assembled with the React facets, so `vanilla-spa-basic` silently inherited React's runtime claim and began full-reloading on every entry edit. `syntax-recovery` started timing out and the dev-transform snapshot showed vanilla emitting `invalidate()`. Any claim attached to the React facet reaches every framework-less project by default; a runtime constraint has to be worth that reach before it is added there.

  React's `createRoot` case is therefore still latent. It is not reproduced anywhere in the suite, and fixing it speculatively cost more than it bought — the honest state is that the mechanism is now understood and the fix is one facet field away once a reproduction exists.

  **`chaos-boundary` is fully live — 4 of 4**, no longer `pendingFor` anything; it was skipped entirely three changes ago. Only the Svelte snapshots moved, which is the scope of the change stated as a diff.

- 2af5252: Make every facet fan-out declare how it composes, and draw the bundler-support line.

  Axiom D4 was already enforced for four hooks — highest priority wins, a tie is a hard error at construction. Eight other fan-outs over the same facet set resolved silently and inconsistently. Two of them were outright defects:

  - **`getTranslations` was `Object.assign` in a loop.** When two content facets produced the same key with different text, the last one in iteration order silently won and the other's content simply never appeared. That is not a merge, it is a coin toss decided by registration order. It is now a declared `union`, and a genuine collision — same key, different value — is a hard error naming both facets. Two facets _agreeing_ about a string is not a conflict and stays legal.
  - **`transformHtml` returned inside its loop.** The first facet implementing it won and every later one was unreachable code: a facet could be registered, be asked for nothing, and have no way to find out. It is now a `chain` — each facet sees the previous one's output — which is also the semantics HTML transformation actually wants, since projections, preloads and bootstrap injection compose rather than compete.

  Two more that were undocumented policy rather than bugs, now stated:

  - **`wrapDefault`** kept the first contributor silently. Facets are already sorted by descending priority, so the outcome was right; what was missing was the tie being an error. Two facets disagreeing about how to wrap the default export at the same rank now fails at construction, like its four siblings.
  - **Facet lifecycle steps** (`setup`, `flush`) ran in a bare sequential `await` loop, so a facet that threw took the loop with it and every facet after it in registration order silently never ran. Each step now settles a `build/pipeline` outcome naming the facet, and a failure stops the step rather than the remaining facets — the composition is `union`, so the facets are independent and one failing does not make the others wrong.

  `ZDB` §7.1 now tabulates the declared composition of **every** fan-out, so the next contributor does not have to infer it from a loop body.

  ## The bundler-support line

  `ZDB` §7a states what a build tool must provide, in two tiers, because "support another bundler" has been an open-ended question and the answer is not uniform.

  **Tier 1 — build.** Virtual modules, a `transform` hook with stable per-file ids, build lifecycle hooks, plugin ordering, and optionally HTML transformation. Every bundler unplugin targets can meet this, and it is where support for a new tool should start.

  **Tier 2 — development.** Everything above plus a hot-update hook, module-graph invalidation, a per-module update token that reaches the client, and a server→client channel. Two of its rows are load-bearing and are why this tier is narrower:

  - **A monotonic, non-repeating timestamp per hot-update event.** Without it there is no ordering authority and D1 cannot be enforced.
  - **`read()` for the content of _that_ event.** Reading the file independently is precisely how a later write becomes a no-op (§4.1a).

  A bundler offering a hot-update hook without those can deliver updates but cannot **order** them — which is the defect this entire specification exists to remove, so shipping dev support on such a tool would be shipping the bug back. And do not emulate the missing sequence with a counter of your own: a second clock that can disagree with the bundler's is worse than no clock at all.

  **On verification.** The unit gate is green at 717 tests, and the facet-heavy contracts (`assets`, `initial-render`) pass in isolation with no facet conflict raised. Full-suite contract runs on the machine used here are unreliable — see the note in `artifact-lifetime`; the pre-change baseline fails worse than the current code under the same load. Re-run `vpr ready:examples` on a quiet machine before drawing contract-level conclusions.

- 553cdae: Tell the compiler when a file is deleted.

  Nothing ever did. The bundler handles `unlink` separately from `change` — it removes the module from its own graph and reloads, but never calls `handleHotUpdate` or `hotUpdate` — and the plugin registered no watcher of its own. A deleted boundary therefore stayed in the compiler's graph and manifest for the life of the process.

  That is worse than stale state, because dev servers are pooled per worker: the orphan outlived the thing that created it. In the contract suite it leaked into every later contract's graph snapshot, and through the compiler's persisted manifest it reached the **committed examples** — twelve generated JSON files describing source that no longer existed, from a single test run.

  `ZintlCompiler.removeFile()` forgets the file and everything it owned: manifest entries, boundary ownership, metadata and dependency graph entries, catalog caches, boundary revisions, and the graph nodes themselves. `MessageManager.trackBoundaryChange` already knew how to drop the boundaries a file no longer owns — passing it an empty set is exactly "this file owns nothing now", and the gap was only ever that a deletion never reached it. The removed boundaries are marked dirty as well: pruning finds orphans by comparing the output directory against the live graph, but the flush still has to be told something changed, or a deletion made during an idle moment sits unflushed until an unrelated edit wakes it.

  The watcher is registered in `configureServer`, deliberately **before** the `appType === "custom"` early return. That exit skips the multiplex middleware, which SSR apps do not want — but they do want their deletions noticed, and registering after it would have left every SSR project with the exact bug this listener exists to fix.

  **`chaos-boundary` is live again on three of four projects.** It had been skipped entirely; it now runs and passes on `react-basic`, `vue-basic` and `vanilla-spa-basic`, with the graph snapshots and the committed examples verified clean afterwards — which is the check that matters, since the leak's damage was always downstream of the contract that caused it.

  Contracts can now declare `pendingFor` — a per-project gap, keyed by manifest name. A blocker is rarely uniform: skipping all four projects to describe a failure on one throws away the three that work, which is the same loss as marking the whole thing green would be, in the other direction. `chaos-boundary` uses it for `svelte-basic`, whose remaining failure is proposal 024 §1.3 — the entry self-accepts, re-executes and mounts twice — and needs a framework-side `hot.dispose()`, not anything here.

  **Unrelated, and pre-existing:** `performance-size` failed once in seven runs during this work, at 10,972 bytes against a 10,240 budget. It is not a regression — it passes in isolation and in six of seven full runs — but it is not measuring what its name suggests either. It captures _dev-mode_ response bodies inside a timing window (its own comment sizes the budget for "Vite dev-mode wrapper overhead"), so which responses land in the window varies. Like `performance-hmr`, it is a smoke check shaped like a budget, and it will get less meaningful as more examples are added rather than more.

- 91662bd: Take custody of hot updates from the watcher to the applied catalog.

  The bundler's watcher is unqueued — `watcher.on("change", (file) => { onFileChange(file).catch(…) })` — so two rapid changes to one file spawn two concurrent update runs. Zintl cannot fix that upstream, but everything below was Zintl choosing not to defend against it.

  - **Invalidation now runs once per event, not once per environment.** The hot-update hook is invoked once for the client environment and again for every other one, so a single filesystem change reached the compiler two or more times: the boundary revision was bumped twice and two re-extractions of the same file raced each other. Later passes now join the first pass's promise instead of starting a competing run. Each environment still invalidates its own module graph, which is the part that genuinely is per-environment.
  - **The compiler stopped re-reading the changed file.** `invalidateFile` read from disk itself rather than using the content the hook was handed. Under two concurrent runs both read whatever was on disk _at that moment_, so the earlier invocation observed the later content and the later one then found nothing to emit — a concrete mechanism for proposal 024 §1.1a's "the write never became a packet".
  - **Catalogs carry the generation that produced them.** Every generated content module is stamped with a monotonic `catalogGeneration`, and the runtime discards a catalog that arrives after a newer one has been applied. A burst of rapid edits now settles on the last one _by construction_ — an out-of-order arrival cannot win a race it never entered.
  - **The summed HMR token is gone.** `boundaryRevisions` was summed across a file's boundaries, which is not injective (two boundaries at revision 1 is indistinguishable from one at revision 2), and emitted into a source comment nothing ever read. The generation replaces it and has an actual receiver.
  - **The second invalidation path is stamped.** The `transform` hook invalidates virtual modules too and set no `lastHMRTimestamp` at all, so modules invalidated from there carried no ordering token whatsoever.
  - **The self-write guard names what it swallows.** It still suppresses edits inside a 500 ms window — narrowing that needs a content-identity check surviving the formatter rewriting the file after the write — but a dropped edit is now recorded rather than silently discarded.

  **A correction worth reading before extending this.** The first attempt applied D1 to invalidation directly: an event older than one already processed was discarded. That regressed `hmr-hammer` from 0 failures in 17 runs to 2 in 17, reproducing exactly the signature proposal 024 §1.1a records — one fewer packet than there were writes, and the DOM stuck on the last state that reached the wire.

  D1 governs deliveries that **replace** state; a newer catalog makes an older one irrelevant, so discarding the older loses nothing. Invalidation does not replace, it **accumulates** — it marks boundaries dirty, clears caches and re-extracts, and each event may describe a different state of the file. Dropping one throws away work no later event redoes, and the update it would have produced is never emitted. The test for which kind you have: _if the newest envelope alone would leave the system correct, it replaces and D1 applies; if earlier envelopes contributed something the newest does not carry, it accumulates and D1 does not._

  This is now `ZDB §4.1a` and a first-class API rather than a convention: `DeliveryBus.observe()` reports position and advances the high-water mark without settling, because `accept()` labels a rejected envelope `superseded`, which on an accumulating channel is a plain lie about what happened — and a ledger that misreports is worse than no ledger. Measured after the correction: 0 failures in 27 runs, against a 0-in-17 baseline.

  `CompilerContext` gains a `bus` field, so a facet performing ordered or repeatable work can take custody of it rather than relying on the surrounding sequential `await` to notice a failure.

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

## 0.1.0-alpha.9

### Patch Changes

- 60517d0: - Add branding assets.
  - Update README files with improved logo branding and unified shield badges.
- Updated dependencies [60517d0]
  - @zintljs/compiler@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- fe9fa30: Resolve runtime dev branches at build time via a `__ZINTL_DEV__` sentinel.

  Every development-only branch in the runtime was guarded like this:

  ```ts
  typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug;
  ```

  Vite does replace `process.env` — production output contained `{}.ZINTL_DEBUG === "true"`, proving it. But `typeof process !== "undefined"` sits in front of the replaceable part and cannot be folded, so in a browser it short-circuits to `false` before the replacement is ever reached. **Client-side debug logging has therefore never produced output**, and the guard added for safety was the exact thing defeating the build-time elimination it was meant to enable.

  `__ZINTL_DEV__` is now substituted to a literal `true`/`false` by `getRuntimeCode()`, driven by the plugin's `isDev`. A literal is the point: production folds the branch away entirely, development keeps it reachable — on the client as well as the server.

  - `getRuntimeCode()` takes a new trailing `isDev` argument, defaulting to `false` so a caller who forgets gets the production runtime. The failure mode is "no debug output", never "debug machinery shipped to users".
  - `I18nStore.debug` now also honours `globalThis.__ZINTL_DEBUG` in a browser. The env-var check alone is unreachable client-side, which is the second half of why client logging never appeared.
  - Adds a development-only settle beacon: `notify()` increments `globalThis.__zintl_version`, giving test harnesses a causal signal that the store applied something instead of making them sleep and hope. Absent in production by construction.

  Verified: production snapshots contain no `console.debug` and no `__zintl_version`, and `debug = typeof process !== "undefined" && {}.ZINTL_DEBUG === "true" || false` now compiles to `debug = false`.

  Consumers importing the runtime modules directly (rather than through `getRuntimeCode()`) must define `__ZINTL_DEV__` in their bundler or test config.

- Updated dependencies [fe9fa30]
- Updated dependencies [fcd99bf]
  - @zintljs/compiler@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- Rename the main package from `zintl` to `zintljs`.

  npm rejects the bare name `zintl` under its package-name similarity filter (`Package name too similar to existing packages intl,vinyl`). The name is unobtainable, so the primary package is now **`zintljs`**, matching the `@zintljs` npm org and the `zintljs` GitHub org.

  **What changed for consumers:**

  ```diff
  - npm install zintl
  + npm install zintljs

  - import zintl from "zintl/vite";
  - import { zintl } from "zintl/macro";
  + import zintl from "zintljs/vite";
  + import { zintl } from "zintljs/macro";
  ```

  **What did not change:** the `zintl()` macro itself. The package name and the exported identifier are deliberately separate — `ZINTL_MACRO` still resolves the `zintl(...)` call expression, and `bindings` in the boundary graph still read `"zintl"`. Only module specifiers moved.

  Internal `virtual:zintl/*` module IDs are unchanged; they are not npm names and keep the project's brand prefix.

  `RUNTIME_PACKAGE` and `RUNTIME_SPECIFIERS` in `@zintljs/extractor`, and `MACRO_PACKAGE` in `@zintljs/compiler`, now point at `zintljs`. Because those constants are baked into the compiler's published output, `@zintljs/compiler@0.1.0-alpha.6` cannot recognize the new specifiers and is superseded by this release.

### Patch Changes

- Updated dependencies
  - @zintljs/compiler@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- 2a07272: Introduced a modular, conflict-free **Adapter Architecture** that decouples framework-specific and toolchain-specific capabilities into discrete concerns. Framework presets (`"react"`, `"vue"`, `"svelte"`, `"vanilla"`, `"html"`, `"nextjs"`) and runtime/bundler layers (`"ssr"`, `"vite"`, `"client-spa"`) compose dynamically into a resolved capabilities map. Key changes include:

  - **Environmental Runtime Splitting**: Decomposed `store.ts` into environment-gated modules (`store-core.ts`, `store-client.ts`, and `store-server.ts`). Vanilla applications now bundle only core translation states, while SPA router synchronization popstates and server request-scoped `AsyncLocalStorage` logic are loaded dynamically on demand.
  - **Vite Plugin Decoupling**: Refactored the Vite plugin config hook to utilize the compiler's presets engine, auto-injecting the `"vite"` preset and detected frameworks, which cleans up hundreds of lines of duplicate codegen and SSR wrapper regexes.
  - **Extension Preservation**: Retained full source file extensions (like `.tsx`, `.jsx`, `.svelte`, and `.vue`) in the boundary ID normalization and compiler maps to prevent naming clashes between files sharing the same base name.
  - **Boundary & Catalog Alignment**: Resolved a bug causing duplicate catalog and schema files (e.g. `App.ar.json` vs `App.svelte.ar.json`) by passing pre-resolved extensions and adapters directly to the `IOManager` constructor to unify normalized paths.
  - **Backward Compatibility**: Embedded fallback translation from `options.targets` to their preset adapters to ensure full compatibility with existing configuration blocks.

- 448dbc6: Gave Zintl's option defaults a single home. Defaults were previously applied lazily at roughly thirty read sites across two packages, several of them duplicated with divergent rules, so answering "where did this value come from?" meant grepping.

  **`resolveOptions()` is now real.** It had been a stub whose entire body was commented out, returning `options || {}`. It now applies every context-free default once, at plugin creation, and `Context` holds the resulting `ResolvedOptions` so downstream hooks read concrete values. A new exported `DEFAULTS` table is the one place a default is written down.

  | default                               | occurrences before | after            |
  | ------------------------------------- | ------------------ | ---------------- |
  | `locales \|\| ["en"]`                 | 9                  | 0                |
  | `sourceLocale \|\| "en"` (plugin)     | 4                  | 0                |
  | `similarityThreshold ?? 0.6` literals | 3                  | 0                |
  | `["md", "txt"]` literals              | 2                  | 1 named constant |
  | harness default blocks                | 2                  | 1                |

  **Three defaults stay unresolved on purpose**, because only Vite can supply them. Each is documented in `DEFAULTS` and applied at exactly one site: `multiplex` (`undefined` → auto-detect by scanning entry files), `verifyIntegrity` (`undefined` → on for `build`, off for `serve`) and `logLevel` (`undefined` → fall back to Vite's own, then `"info"`). `logLevel` previously had three stacked defaulting layers and `verifyIntegrity` three rules that disagreed, one of which relied on spread ordering to let a user value win.

  `outputDir`, `catalogFormat`, `metadataDir` and `similarityThreshold` are deliberately left unset by the plugin so the compiler applies its own — re-stating them would recreate the duplication being removed.

  **Fixed a shared-array aliasing bug** found while writing the new tests: the default `locales` array was a single instance handed to every caller, so one plugin instance mutating its locale list would corrupt another's. Array defaults are now copied per call.

  **Compiler-side deduplication.** `DEFAULT_RENAME_THRESHOLD` is exported from `reconcile.ts` and reused by the assets facet, which had hardcoded `0.6` three times. The assets facet's `["md", "txt"]` default is a named constant instead of two inline literals. `AssetFacetConfig` drops its `assetsTarget` alias, so the concept is spelled `targets` at the facet level and `assetsTarget` at the plugin level, bridged in exactly one commented line in `facets/assemble.ts` — previously three spellings reconciled by a rename inside the factory. `IOManager` takes a narrow `IOManagerOptions` (just `metadataDir`) rather than the whole `CompilerOptions`, and its duplicated metadata-directory resolution is collapsed into one method.

  **Removed dead configuration.** The `ZINTL_TEST_OUTPUT_DIR` / `ZINTL_TEST_METADATA_DIR` environment overrides were read in `configResolved` but nothing in the repository ever set them. The test harness's Vite alias pointing at `packages/runtime/src/*` referenced a directory that does not exist.

  **New coverage** for territory that had none: `resolveOptions` pins every documented default and asserts that falsy user values survive, and `flattenFacets` / `autoFacets` / `assembleFacets` are tested directly — including that `viteFacet()` is always injected and that the generic SSR facet is never paired with Next.js, which would otherwise be a facet conflict.

- 4031237: Consolidated the facet configuration and instantiation pattern. Replaced static facet objects and custom creation helpers with standardized function factories named `nameFacet(options?)` (e.g., `vanillaFacet()`, `assetsFacet()`, `viteFacet()`). Introduced compound facet factories (e.g., `reactFacet()`, `vueFacet()`, `htmlFacet()`, `nextjsFacet()`, and `ssrFacet()`) to return a flattened list of concerns under a single configuration entry. Relocated all preset automation and auto-resolution logic from the compiler core to the Vite plugin, making the compiler entirely logicless. Finally, renamed `ZintlOptions` to `CompilerOptions`, and re-exported all facet factories directly from the `zintl` plugin package so users do not need to install the compiler package to customize facets.
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

- 1061058: Refactored the compiler extension model from Adapters to Facets, formalizing the Concern-Faceted Compiler Architecture and Dimension-Constrained composition system. Renamed `ZintlAdapter` to `ZintlFacet`, `resolveAdapters` to `resolveFacets`, and the `adapters` configuration options to `facets` across the compiler, plugin, examples, and tests.
- e1e504d: Prepare the packages for their first public release.

  - **Renamed the npm scope** from `@zintl/*` to `@zintljs/*`. The `zintl` org name was unavailable on npm; the primary package remains `zintl`, so application code importing `zintl` and `zintl/macro` is unaffected. Only direct consumers of `@zintl/compiler` and `@zintl/extractor` need to update.
  - **Corrected the Vite peer range** to `^6.0.0 || ^7.0.0 || ^8.0.0`, verified by building a real app against stock Vite 6.4.3, 7.3.6, and 8.2.0. The plugin relies on the Environment API (`hotUpdate`, `this.environment`), which does not exist in Vite 5, so the previous `^5.0.0` range advertised support that could never work.
  - **Pinned `oxc-parser` and `@oxc-project/types`** to `^0.142.0` in the workspace catalog. They were set to `latest`, which would have published `@zintljs/extractor` with an unpinned runtime dependency on a pre-1.0 parser.
  - **Trimmed the publish surface** with an explicit `files` field. The `zintl` tarball drops from 91 files (535 kB unpacked) to 13 files (103 kB) — build config and sources are no longer shipped.
  - **Added `engines`, `repository`, `homepage`, `bugs`, and `keywords`** to every published package, and gave `@zintljs/compiler` and `@zintljs/extractor` their own READMEs.
  - **Moved npm provenance out of `publishConfig`** so that publishing is possible outside of CI. Provenance requires a public source repository and CI OIDC; it is re-enabled via `NPM_CONFIG_PROVENANCE` in the release workflow.
  - **Marked `@zintljs/testing` as private.** It backs the internal e2e suite only and is no longer part of the release surface.

### Patch Changes

- 3fd61d3: Ensure deterministic boundary and chunk graph serialization by implementing deterministic sorting helpers:

  - **Deterministic Serialization**: Added the `serializeDeterministic` utility to recursively format and sort `Map` keys, `Set` elements, and arrays of objects (such as `BoundaryDep` lists) by stable properties (e.g. `id` or `name`).
  - **Strict ESLint Compliance**: Included a localized string comparison helper `compareStrings` to satisfy array sort checks without the performance overhead of Unicode-based `localeCompare`.
  - **Contract Tests Snapshot Stability**: Updated the contract graph test suite to utilize the new deterministic serializer, preventing random reordering failures on successive test runs.

- fdda8fa: Refactored the compiler and Vite plugin wrapper to establish a fully adapter-driven modular architecture. Eliminated hardcoded fallbacks for extensions in the plugin wrapper config resolved hooks. Preserved physical JSON catalog formats for robust schema-enforcements, auto-healing, and recovery. Added support for custom Handlebars SFC template block extraction and dynamic runtime multi-brand slogans resolution, utilizing robust regex rewriter hooks. Added type definitions for SFC identification on codegen contributions. Unified the HTML projection preset adapter with the compiler's extraction manifest to merge standard extracted text keys and metadata (such as titles, descriptions, and directions) into the generated schemas, resolving validation conflicts under `additionalProperties: false`.
- 72acaa8: Expanded SSR entry point file extension matching in the compiler presets to support JSX/TSX:

  - **SSR JSX/TSX Entry Wrapping**: Added support for `.tsx` and `.jsx` file extensions when detecting and wrapping server entry points inside `runInRequestScope` in the `ssr` and `nextjs` presets.

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

## 0.1.0-alpha.5

### Patch Changes

- a16cedd: Evolved the compiler to be completely framework-agnostic (zero-knowledge) by eliminating all default `.vue` and `.svelte` fallbacks from the core extensions and search paths. Configured the host Vite plugin to dynamically calculate target extensions and pass them to the compiler. Refactored the React target adapter matching rule to dynamically exclude registered SFC extensions and HTML files without hardcoding Vue or Svelte.

  Abstracted dynamic imports and virtual module paths inside the compiler. Added `resolveVirtualPath` and `dynamicImportTemplate` options callbacks, allowing any host bundler plugin to configure custom virtual namespaces (e.g. queries) and ignore-comments (e.g. webpackIgnore/vite-ignore) dynamically.

- b7a327e: Fixed HMR rendering issues and resolved timing race conditions during source translation updates:

  - Updated the translation resolver (`_t`) to immediately re-evaluate catalog lookups after synchronous self-registration, preventing blank rendering.
  - Propagated HMR timestamps (`lastHMRTimestamp`) on all invalidated virtual modules in `handleHotUpdate` to ensure Vite's `importAnalysis` rewrites imports with correct timestamp query parameters.
  - Introduced automated page auto-refresh (full-reload) for server-side (SSR) only boundaries and catalogs when modified.

- 97733bb: Fix phantom boundary integrity errors and phantom asset output for projects without a `zintl()` anchor:

  - **`verifyIntegrity` — phantom boundary guard** (`packages/compiler/src/index.ts`): Added an early exit when `bg.entries.size === 0` so that projects with no trust anchors (e.g. a freshly migrated Next.js / vinext app) no longer throw `[Zintl Integrity Error]` for strings extracted by the aggressive stitching engine. When anchors do exist, tightened `isReachable` to check actual reachability from an entry point via `getStaticDependencyTree` instead of mere membership in `bg.nodes`, so phantom boundaries that live outside the anchor dependency chain are silently skipped rather than integrity-checked.

  - **`AssetManager` — phantom asset write guard** (`packages/compiler/src/managers/AssetManager.ts`): Extended `isAssetUsed()` with a boundary graph anchor check that fires only when real Vite module-graph information is available. If the Vite dep graph is populated but `bg.entries.size === 0`, the asset is classified as a phantom and `syncSingleAsset()` returns early without writing any localized output file. In isolated mode (unit tests, programmatic API usage without a Vite instance) the dep graph is empty so the original "assume used" fallback is preserved, keeping all existing asset tests passing.

- a64c32c: Fixed React HMR support, nested entry point reachability checks, and documented the synchronous catalog injection behavior:

  - Corrected boundary graph reachability traversal (`isReachable`) to resolve file paths against target nodes, fixing HMR invalidation failures for nested/bootstrap anchors.
  - Documented the framework-agnostic Synchronous HMR Catalog Injection in `SPEC/ZHMR.md` which leverages Vite's execution order to update the active translation store before component re-renders, rendering manual store subscriptions obsolete.

- 0bd00a8: Fix evaluation of dynamic attributes, tag replacement, and boundary resolution in JSX/SFC compilation:

  - **Export and Import Boundary Resolution**:
    - In `@zintl/extractor`: Maps default and named exports of components to their precise function-level boundary IDs (e.g., `src/App:App` instead of the file boundary `src/App`) in the program visitor.
    - In `@zintl/compiler`: Resolves static import bindings to their precise exported function-level boundary IDs when walking the dependency graph in `intent-utils.ts`, and adds file-level fallback resolution to ownership mapping checks.
  - **Dynamic JSX Attribute Evaluation**: Serializes `_tags` for JSX components as raw JavaScript array literals rather than JSON strings, allowing local scope variables (like imported assets) to be correctly evaluated at runtime.
  - **JSX to HTML Attribute Mapping**: Automatically maps `className` to `class`, and JSX attribute expressions like `src={logo}` to template literal interpolations `src="${logo}"` for elements inside translated templates.
  - **Self-Closing Tag Placeholders**: Extends the runtime key resolver and compile-time baking to support self-closing tags (both `<tag/>` and `<tag />`) when replacing translatable element placeholders.

- a9942b8: Shared server-side AsyncLocalStorage and registry store context on globalThis to prevent request context leaks and hydration mismatches across RSC and SSR environments:

  - Shared request-scoped `storeStorage` (AsyncLocalStorage), `globalRegistry`, `defaultInstance`, and `currentInstance` on `globalThis` in the runtime compiler store to bridge the RSC and SSR execution scopes on the server.
  - Restored standard Vite HMR catalog hot updates by reverting the experimental full-reload trigger for catalog updates.
  - Improved the missing key warn log in translation resolver to print the target boundary ID (`targetBId`) instead of the manager ID.

- 8f51ff6: Added configuration-driven SSR/RSC request isolation support for virtual entry points, zero-config framework auto-detection, and robust URL parsing:

  - Added configuration properties `ssrEntryTargets`, `ssrWrapDefault`, and `ssrWrapExports` to `ZintlOptions` to support generic wrapping of entry points with `runInRequestScope`.
  - Added zero-config auto-detection and defaulting of SSR options (`ssrEntryTargets`, `ssrWrapDefault`, `ssrWrapExports`) for the `nextjs` target (e.g. Next.js / Vinext entries) when using the default target configuration.
  - Robustly extracted the locale from incoming request URLs containing protocols, hostnames, query parameters, or hashes during request-scoped store initialization in `runInRequestScope`.
  - Allowed transformation and request isolation wrapping on registered virtual entry targets (such as `virtual:vinext-rsc-entry` and `virtual:vinext-server-entry`) by bypassing extension and virtual module early returns in the compiler transform process.
  - Updated `zintl` Vite plugin config and transform hooks to forward the new parameters and allow processing of virtual module paths matching `ssrEntryTargets`.

- a6aabcf: Introduce **Virtual Assets Mode** (zero-disk asset reference compilation) to allow building and resolving localized static translation assets purely in memory:

  - **Virtual Assets Configuration**: Added the `virtualAssets?: boolean` option to compiler settings to bypass writing target files to the local filesystem during compilation.
  - **In-Memory Translation Registry**: Integrated localized catalog generation directly with the translation Hive, dynamically retrieving and fuzzy-matching translations virtualized in memory.
  - **Vite/Rollup Asset Emission**: Configured the plugin hooks to map target asset imports to virtual modules (`\0virtual:zintl/asset/...`), emitting optimized and hashed static assets directly via Rollup's `this.emitFile()` API.
  - **Support for raw text and binary loaders**: Supports loading virtualized text and Markdown files under standard and `?raw` loader streams, exporting translated strings as JS modules.

- 8aefe85: Refactor Vite plugin hooks (`resolveId`, `load`, and `transform`) to support Vite 6's Environment API (`this.environment`) for SSR detection, while maintaining backward compatibility with Vite 5 using fallback options.
- Updated dependencies [3ceeaf3]
- Updated dependencies [a16cedd]
- Updated dependencies [b7a327e]
- Updated dependencies [97733bb]
- Updated dependencies [a64c32c]
- Updated dependencies [0bd00a8]
- Updated dependencies [7dd0bfb]
- Updated dependencies [372448e]
- Updated dependencies [f7ee691]
- Updated dependencies [a9942b8]
- Updated dependencies [8f51ff6]
- Updated dependencies [a6aabcf]
  - @zintl/compiler@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- 365d1d2: Fix production SSR client hydration mismatch and Vue SFC multiplex caching:

  - Virtualize Vue and Svelte SFC paths by locale (e.g. `HelloWorld.zintl-ar.vue`) in `resolveIdHook` and `loadHook` to prevent descriptor caching collision in the SFC compilers.
  - Normalize localized virtual SFC paths back to clean original paths in `packages/compiler/src/managers/IOManager.ts`.
  - Allow relative imports within virtualized `.zintl-` SFCs to propagate their locale and get virtualized rather than returning raw clean paths immediately.
  - Skip processing Vue and Svelte virtual sub-requests in `loadHook` and `transformHook` to prevent overriding pre-compiled blocks with raw template blocks.
  - Trim catalog key matching and variable mustache lookups with padding preservation in the compiler pipeline to ensure translations match and preserve leading/trailing whitespace.

- Updated external dependencies:
  - @types/node@^24.12.4
  - typescript@^5.9.3
- Updated dependencies [365d1d2]
- Updated dependencies [a6ab4f6]
- Updated dependencies [365d1d2]
- Updated dependencies
  - @zintl/compiler@0.1.0-alpha.4

## 0.1.0-alpha.3

### Minor Changes

- 776aca8: Introduce Single File Component (SFC) extraction/transformation for Vue and Svelte, automatic target resolution, and performance optimizations:
  - **SFC Extraction Support**: Added support for `.vue` and `.svelte` templates and scripts in `@zintl/extractor`. Implemented script block slicing, tag stripping, and position/offset translation for variables, transforms, and locations to map them correctly back to the original source file.
  - **Vue & Svelte Target Presets**: Expanded Target Presets to include comprehensive configurations for Vue and Svelte elements (e.g., translatable attributes like `alt`, `placeholder`, `aria-label`).
  - **Dynamic HTML & Attribute Wrapping**: Added support for SFC-aware rewriting in `@zintl/compiler`. HTML text nodes with dynamic nested tags are automatically wrapped in framework-specific logic (`<span v-html="...">` for Vue, `{@html ...}` for Svelte), and normal text interpolations map to `{{ ... }}` or `{ ... }`. HTML attributes are transformed into reactive bindings (`:attr="..."` or `attr={...}`).
  - **Automatic Target Detection**: Added an `auto` option to the plugin targets. It dynamically queries the project `package.json` dependencies and Vite plugin configurations to auto-configure appropriate extraction targets.
  - **Compiler Flush Performance Recovery**: Optimized the compiler's warm-path flush latency to resolve benchmark regression:
    - Cached the reachable graph nodes in `ZintlCompiler` (`reachableCache`) to avoid repetitive DFS traversals per locale/boundary.
    - Implemented string comparison caching (`lastManifestContent`) for metadata manifests in `MessageManager` to bypass redundant disk writes/reads.
    - Bypassed empty synchronization tasks for assets and HTML projections when there are no updates.
    - Added on-disk verification caching (`confirmedOnDisk`) for catalogs and schemas to avoid multiple expensive `fs.exists` checks on subsequent rebuilds.
  - **Vite Transform Query Safety**: Configured the transform hook in the Vite plugin to skip transforming modules containing query parameters unless they are explicitly tagged with `zintl-multiplex=`, avoiding conflicts with non-JS file assets.
  - **ICU Baker Warnings**: Refined ICU message checking warnings to bypass mustache expressions (`{{ ... }}`) and focus warnings only on actual syntax errors.

### Patch Changes

- 18a7166: Bypassed code transformations and catalog generation/pruning for non-zintlized files and projects:

  - **Bypass Transformations for Non-Zintlized Projects**: Updated the compiler transform pipeline to check for the presence of Zintl entry points/anchors in the project, completely skipping AST transforms and manager injection for projects with zero active entry points (like the `vanilla-ssr` example).
  - **Conditional Vitest Testing Support**: Allowed unit tests checking isolated transforms to continue running in Vitest by identifying test environment file contexts and selectively bypassing the anchor-check.
  - **Dynamic Catalog Restriction**: Updated the catalog manager to skip syncing and pruning boundary catalogs when zero active entry points exist.
  - **Test Coverage**: Added dedicated unit test coverage verifying that non-zintlized source files with UI sinks remain untransformed when no Zintl entry points are present.

- 18a7166: Added support for inline SVG elements during HTML/JSX parsing and resolved fanned routing redirect intercepts in development mode:

  - **SVG Phrasing Elements Support**: Added common SVG child tags (`use`, `path`, `circle`, `rect`, `g`, etc.) to the list of inline phrasing tags. This prevents HTML/JSX text stitching from partitioning at unrecognized sub-tags, eliminating unmatched closing tag validation errors and schema warnings during catalog compilation.
  - **Fanned Routing Support in Dev Mode**: Updated the Vite development index HTML interception logic to inspect both the filesystem path and request path. This prevents custom SSR development servers from rendering empty redirect shells when navigating fanned localized routes.
  - **Request-Scoped SSR Compilation**: Restricted contextual anchor locale baking in the compiler transform when performing server-side builds. This ensures that multi-locale Express/custom SSR servers can generate request-scoped translations dynamically.

- 18a7166: Added support for Server-Side Rendering (SSR) request context isolation and automatic client-side locale inheritance:

  - **SSR Request Scope Isolation**: Integrated compile-time wrapping of the server entry point's exported `render` function inside `runInRequestScope` to prevent request state pollution.
  - **Client Locale Inheritance**: Added client-side oracle mechanism to automatically read and hydrate locale from `document.documentElement.lang`.
  - **Sequential Runtime Builds**: Updated build commands for packaging compiler runtime targets sequentially, avoiding shared chunk collision in virtual imports.
  - **Idempotency Guard**: Added protection in compiler transform to prevent double-wrapping render exports if transformed multiple times during build execution.
  - **Redirect Loop Resolution**: Added path check guards in the client-side redirect script to prevent infinite redirect loops on fanned locale endpoints.
  - **SSR appType Support**: Bypassed DevServer HTML-interception middleware when Vite configuration specifies `appType: "custom"`, allowing Express/custom SSR servers to manage routing and server-side redirection cleanly.

- 776aca8: Fix HTML catalog generation pollution in SFC templates, ignore only-variable text nodes, and optimize translation loader generation:

  - **SFC Catalog and Schema Sanitation**: Prevent `.vue` and `.svelte` files from being incorrectly identified as HTML document projections. This stops the creation of schema files and catalog files containing page-level settings (like `dir`) for SFCs.
  - **Variable-Only Text Node Omission**: Ignore text nodes inside Vue/Svelte SFC templates that only contain variables (e.g. `{{ l.name }}`), avoiding empty translation key generation (`"{var0}"`).
  - **Kingdom-Based Loader Optimization**: Optimize the compilation rewrite of the `zintl` macro. If a boundary manager (and all of its child boundaries/colony files) does not contain any translatable messages or asset dependencies, it is omitted from loader registration to minimize runtime initialization overhead.

- Updated dependencies [18a7166]
- Updated dependencies [776aca8]
- Updated dependencies [18a7166]
- Updated dependencies [18a7166]
- Updated dependencies [776aca8]
  - @zintl/compiler@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Introduce universal target presets, configurable assets mapping, and testing suites:

  - **Target Preset Customization**: Added framework target presets (`react`, `vanilla`, `html`) and a Target DSL in the extractor, allowing developers to configure translatable attributes, sinks, and object property targets.
  - **Universal Asset Targets (`assetsTarget`)**: Added support in the compiler for glob-based asset routing configurations, supporting strategy overrides (such as binary pass-through, text pass-through, frontmatter) and custom strategy callbacks.
  - **Catalog Group-by Path Routing**: Grouped asset catalogs by locale and original relative paths to prevent collisions across multiple files sharing identical basenames.
  - **Testing Verification**: Created dedicated unit test suites covering targets preset expansion, Target DSL parsing, resolver caching, extractor targets integration, and custom asset strategy callback execution.
  - **Decoupled Reference Calibration**: Decoupled the benchmark calibration step from extractor implementation, running it as a pure JS mathematical loop to stabilize execution speed measurements and prevent false budget regression alerts.

- Updated dependencies
  - @zintl/compiler@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Rebranded the primary Vite plugin package from `@zintl/vite` to `zintl` to serve as the unified main entry point. Updated the compiler import resolution pipelines, extractor AST visitor patterns, configurations, and example imports to resolve and load from `zintl` and `zintl/macro`.

### Patch Changes

- Updated dependencies
  - @zintl/compiler@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `@zintl/vite/macro` has been streamlined as a lean, zero-dependency facade.

### Patch Changes

- Updated dependencies
- Updated dependencies [be116c3]
  - @zintl/compiler@0.1.0-alpha.0

## 0.0.3

### Patch Changes

- Updated dependencies [be116c3]
  - @zintl/compiler@0.0.3
  - zintl@0.0.3

## 0.0.2

### Patch Changes

- Update Vite integration snapshots and examples for collapsed identical tags:
  - **Vite Snapshot Harmonization**: Standardized vanilla-spa and baked-i18n snapshots to align with collapsed phrasing tag normalization.
- Updated dependencies
  - @zintl/compiler@0.0.2

## 0.0.1

### Patch Changes

- Fix and optimize production build fanning hook forwarding and static asset multiplexing:

  - **Durable Plugin Getters**: Exposed `__options` and `__compiler` getters directly on the `mainPlugin` object so they survive Vite's internal plugin array flattening during production builds.
  - **Asset Multiplexing Isolation**: Bound multiplex query propagation exclusively to Zintl-eligible file extensions, preventing duplicate build output chunks for raw static assets.

- Updated dependencies
  - @zintl/compiler@0.0.1
