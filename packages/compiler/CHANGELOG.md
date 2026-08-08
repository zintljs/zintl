# @zintl/compiler

## 0.1.0-alpha.14

### Minor Changes

- 7779a8b: Gave the HTML projection a host-neutral path, so `<html lang>`/`dir`, `<title>` and `<meta description>` follow the locale on Rsbuild as they do on Vite.

  `compiler.transformHtml()` was always host-neutral; what was not is the only thing that ever called it — Vite's `transformIndexHtml`, which lives in the plugin's `vite` block and which unplugin drops on every other target. Rsbuild's `api.modifyHTML` has the same shape, so this is wiring rather than a second implementation, routed from the plugin's `rsbuild` block. Deliberately **not** a `BundlerFacet` hook: `ContentFacet.transformHtml` already exists and _is_ the projection, so a bundler hook of the same name beside it would reproduce a naming collision this codebase has been bitten by before — and registering `modifyHTML` is plugin work that a facet, being data and string-returning functions, cannot do.

  **Two things had to be solved that a straight wiring would not have caught.**

  _Identity._ Rsbuild hands the hook an output filename (`index.html`, relative to `dist`) where Vite hands an absolute source path. The projection re-reads the source on a cache miss and computes sink offsets against it, so passing the output name through produces a blank page. It is now inverted through `htmlPaths` and `html.template` back to the source id — and when any step yields nothing, which happens for real when Rsbuild uses its built-in template, it warns and declines rather than silently doing nothing.

  _The boundary link._ Zintl learns which scripts a document loads by reading `<script src>` from markup, and turns them into the document's dependencies — which is how a page reaches a trust anchor and becomes a boundary at all. An Rsbuild template names no scripts: the entry is injected at build time from `source.entry`, so the association lives in the build config. With nothing to read, no HTML document reached a boundary on this host, no catalog was ever scaffolded for one, and the direction map came out empty.

  `CompilerOptions.htmlEntries` is the new declaration — keyed by html id, valued with source ids, unioned with whatever the markup says and empty on every host whose templates name their own scripts. It updates both `htmlProjection.scripts` and `dependencies`, because the extractor derives the second from the first _during_ extraction and afterwards they are two separate facts.

  **Also generalised**: the `locale-switch` contract asserted a request URL containing `virtual:zintl/content/<locale>/`, which is Vite's virtual-module spelling — an Rspack build emits catalogs as ordinary hashed async chunks. The question the contract asks is host-neutral; only the spelling is not, so an optional `LocaleSwitchAdapter.isCatalogRequest` holds the per-project answer and defaults to the Vite form.

- 654569d: Made `<html dir>` follow the active locale on any host, and fixed two defects that stopped it following reliably on Vite.

  Direction used to reach the document only through the HTML projection, which Zintl injects via `transformIndexHtml` — a Vite hook that unplugin drops everywhere else. The runtime had no direction data of its own and deliberately set only `lang`.

  It now has the data. `ContentFacet.rtlLocales` is a new hook, unioned by `ZintlCompiler.getRtlLocales()` and substituted into the generated runtime as a literal array, so the store can set `dir` wherever it already sets `lang`. Core learns nothing about direction or about RTL languages: it merges string arrays that facets return. The HTML facet answers by reading the `dir` field already written into every HTML catalog — so this is one derivation moved to where two consumers can share it, not a new source of truth, and there is no list of RTL languages anywhere in the runtime.

  **Two defects fixed on the supported path**, which together explain why adding an HTML catalog to a page could stop `lang` updating:

  - The projection's `apply()` returned early when `lang` already matched the target locale — but it owns `dir` as well, so anything that set `lang` first permanently locked `dir` out with no way to correct it. Every statement in that function is an idempotent assignment, so the guard bought nothing.
  - The store's own attribute handling was an `else` branch behind `window.__zintlApplyHtml`. The projection installs that function unconditionally but writes `dir` only when the project has an RTL locale, so on every other project it took ownership of the document and then declined to finish the job, silently suppressing the fallback. The two now run in sequence: the store owns `lang` and `dir`, the projection owns the document-specific title, description and body deltas.

  `dir` is written only when the project actually has direction data. Empty means "this project never spoke about direction", and asserting `"ltr"` there would start writing an attribute onto documents that never had one.

  **Removed: the dead `sourceLocale` field on `I18nStore`.** It was written by a build-time substitution and never read — the only occurrence in the whole runtime was its own declaration — and it shipped in every production bundle. Its substitution was also the fragile kind: a regex matching a TypeScript class-field default, one `readonly` keyword or formatter change away from silently matching nothing. `getRuntimeCode` drops its `sourceLocale` parameter and gains `rtlLocales`, which uses the same word-boundary sentinel mechanism as `__ZINTL_DEV__`.

- 0926c2e: Routed virtual-module **recognition** through the bundler facet, closing the half of that seam that never existed.

  `BundlerFacet.resolveVirtualPath` existed to construct virtual ids. Nothing existed to recognise them: core tested `id.startsWith("\0")` — Rollup's convention, hardcoded into a bundler-agnostic layer — at seven sites deciding whether a module was Zintl's own, and therefore whether to normalize it, give it a catalog, or let it become a boundary.

  On Rspack that test is false for virtual modules past the `transform` boundary, because unplugin materialises them as real files under `node_modules/.virtual/`. Nothing broke, because an adjacent `id.includes("node_modules")` test happened to be true — correct behaviour resting on another project's choice of directory name, which would have failed silently by extracting strings from Zintl's own generated catalogs the day that directory moved.

  `BundlerFacet.isVirtualId` is the counterpart. It uses substring rather than prefix semantics, because boundary ids embed the module id they were minted from; Rspack's implementation recognises both spellings a virtual module has on that host. `IOManager` holds and exposes it, since every other manager already holds an `IOManager` and none hold the system view. With no bundler facet the default stays the `\0` test, so nothing changes for the compiler's own unit tests.

  Six of the seven sites moved. The seventh strips a `\0` prefix so a user's SSR entry pattern can match and already tries the unstripped id too — it normalizes rather than asking about ownership, so it stays a byte test with a comment saying why.

  **Also fixes a blind spot in the guardrail meant to catch exactly this.** The facet-composition golden files report single-provider hooks from two hand-maintained arrays, and `hmrSelfAcceptCode` had been missing from both since it was added — so a facet-surface change was invisible to the artifact whose purpose is making facet-surface changes visible. Both hooks are listed now, with a note at the arrays.

  Adds `tests/fixtures/multiplex-assets.ts`, a multiplexed project with `virtualAssets` and a localized binary asset. It covers `emitFile` and `import.meta.ROLLUP_FILE_URL_*` under multiplex, which had no coverage at all.

### Patch Changes

- @zintljs/extractor@0.1.0-alpha.14

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

### Patch Changes

- 6926203: The document now announces the locale the store actually adopted, on every host.

  Zintl publishes a locale change to `<html lang>` by calling `window.__zintlApplyHtml`, which is installed by the HTML projection script — and that script is injected through `transformIndexHtml`, a Vite-only hook. On any other bundler no projection exists, so a page could switch locale, render the new language, and go on announcing the old one to assistive technology and search engines.

  `publishLocale` now sets `document.documentElement.lang` itself when no projection is installed. The store always knows the locale it adopted, so it can say so unaided, and the branch runs only when nothing better is present — the projection keeps full ownership wherever it exists.

  `dir` is deliberately not handled here. Direction is per-locale data the projection reads out of catalogs at build time; giving the runtime its own table would put a list of RTL languages in the compiler core, which is knowledge that belongs to a facet.

- 49f299c: Fixed the translation-neutrality walk skipping dependencies imported without a file extension.

  `GraphManager.hasTranslatableContent` decides whether a module needs a per-locale copy during multiplex propagation. It resolved a relative dependency by path-joining alone, so `./counter` became `src/counter` — a key in no graph — and the walk stopped there, reporting the importer as having nothing to translate. It now resolves through `resolveDependencyFileId`, which tries each known source extension, as every other traversal in that file already did.

  The failure direction is why this matters: "neutral" means _needs no per-locale copy_, so a false positive silently drops a module's translations, where a false negative only costs a redundant copy.

  A second defect surfaced while testing it and is now closed: `resolveDependencyFileId` resolved against the manager's last-built graph state while its caller was handed graphs as arguments, so the two could disagree about which files exist. The graphs are now overridable parameters.

  Resolution deliberately keeps **exact** key lookups. Also matching the manifest's `<file>:<boundary>` prefix during resolution looked correct but cost a `Object.keys` scan per candidate, per extension, per dependency edge, and blew the Structural and Colony HMR budgets by 48% and 23% on an idle machine. It bought nothing: a file with manifest entries is keyed in the metadata and dependency graphs too, and both are exact. Content discovery still prefix-matches, once per node rather than once per candidate.

  No output changes: the predicate short-circuits as soon as the importing module itself has content, so a dependency's resolution only decides the answer for an inert module whose sole translatable content sits behind an extensionless import in a multiplexed project. Adds the first unit coverage this predicate has had.

  - @zintljs/extractor@0.1.0-alpha.13

## 0.1.0-alpha.12

### Minor Changes

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

### Patch Changes

- @zintljs/extractor@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- 43ebb95: Fix a race in `flush()` that could silently drop the latest edit to a boundary under rapid, overlapping hot updates.

  `runFlush` snapshotted the dirty boundary set into `adopted` before writing catalogs, then unconditionally cleared every adopted id from `dirtyBoundaries` afterward. If a newer edit re-dirtied that exact boundary after its catalog had already been written but before that cleanup ran, the cleanup deleted the fresh dirty flag anyway — the newer content was never flushed, and nothing was left to schedule it for later. Locally each edit's cycle finishes before the next one starts, so the window never opened; under CI's slower scheduling, overlapping flushes were common enough to hit it, which is why `hmr-hammer` only flaked in CI.

  `MessageManager` now tracks a `dirtyRevisions` counter per boundary, bumped by a new `markDirty()` on every dirty mark. `runFlush` snapshots each adopted boundary's revision at adoption time and only clears it if the revision is unchanged — i.e. nothing re-dirtied it while this run was writing.

- 7c69554: Updated external dependencies:

  - @formatjs/icu-messageformat-parser@^3.5.16
  - magic-string@^1.1.0
  - vite-plus@0.2.7

- Updated dependencies [7c69554]
  - @zintljs/extractor@0.1.0-alpha.11

## 0.1.0-alpha.10

### Minor Changes

- 91662bd: Add the delivery bus — a governance discipline for ordered, repeatable work.

  Zintl does the same shape of work in four places: something changes, a procedure runs, and a result is delivered elsewhere. A file changes and a packet is emitted. A catalog arrives and a store applies it. A flush is requested and disk is written. A facet is asked and contributes. Every one of those is repetitive, concurrent, and capable of conflicting with itself — and none of them had a name for **what** was being delivered, **in what order**, or **whether it landed**.

  The measured consequences: a later update losing to an earlier one, a boundary rendering blank permanently with nothing recorded, a flush silently discarding the boundaries a second flush had dirtied, and outputs surviving on disk after the source that produced them was gone.

  This is not a message queue and not a transport. It is five absolute axioms plus the smallest data structure that enforces them, specified in `docs/spec/ZDB.md` and promoted alongside ZRS/ZHMR/ZCD:

  - **D1 Monotonic Supersession** — a receiver discards anything not newer than what it applied. Latest wins _by number_, never by arrival time and never by a debounce window.
  - **D2 No Silent Abandonment** — every envelope reaches `applied`, `superseded` or `failed`. Coalescing is a named outcome, not a disappearance.
  - **D3 Causal Custody** — a stage that coalesces inherits the superseded envelope's subjects, so no subject is left without a custodian.
  - **D4 One Subject, One Owner** — competing contributors resolve by declared rank; a tie is a hard error at construction.
  - **D5 Cost Asymmetry** — identity and sequence ship; the ledger and every reason string are development-only and eliminated at build time.

  `DeliveryBus` is exported from `@zintljs/compiler`, with `mint`/`accept`/`holds` as the ordering machinery and a bounded ring for diagnosis. Recording is off by default, so a caller who forgets gets the cheap bus: the failure mode is "no diagnosis available", never "diagnostic machinery left on". The ring is bounded normatively rather than as an optimisation — `memory-leak` measures retained heap across twenty consecutive hot updates with only a few hundred kilobytes of headroom.

  Two documents were reconciled against the code on the way in. Proposal 024 is marked ABSORBED, with the three things it got wrong called out. **ZRS §9.1 is superseded**: it promised a source-locale fallback and exponential-backoff retry, neither of which was ever implemented, and the first of which is forbidden outright — a missing translation is a build-time error, not a reason to render a different language. The original text is preserved rather than deleted, because knowing which model was intended and rejected is worth more than a silent removal.

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

- 9c10e78: Make the compiler's own stages recoverable, ordered and accountable.

  The flush and the graph rebuild were the compiler's versions of the two defects the runtime had: one collapsed concurrent callers onto work that did not include their changes, the other let whichever rebuild _finished_ last decide the world.

  - **A failing flush no longer poisons every later one.** `flushPromise = null` was the last statement _inside_ the async body, so a single throw left a rejected promise cached and every subsequent flush returned that same rejection for the life of the process. `verifyIntegrity` throws by design on a missing translation, and the hot-update hook swallows the result with `.catch` — so a compiler could stop flushing entirely and nothing would say so. Now cleared in a `finally`.
  - **A flush no longer destroys work it never adopted.** The run snapshotted `dirtyBoundaries` near its start and cleared the whole set near its end, so a boundary dirtied _during_ the run was not deferred — it was discarded, and no later flush knew it existed. Only the boundaries a run actually adopted are cleared.
  - **A caller arriving mid-flush gets a follow-on**, not the in-flight promise. Awaiting someone else's run resolves to "their work finished", which is not what the caller asked (Axiom D3).
  - **A graph rebuild that was overtaken discards its result.** `graphDirty` is cleared _before_ the async body runs, so a transform during a rebuild starts a second concurrent one; both then assigned `boundaryGraph`/`chunkGraph` and the winner was whichever finished last. Rebuilds genuinely replace state, so D1 applies here — unlike invalidation, which accumulates (ZDB §4.1a).
  - **The hive is written by the flush.** It had its own debounce on the same 300 ms constant, with nothing sequencing the two, so a burst of edits could write the hive from a state the flush had not reconciled. The timer survives only as a fallback for when no flush follows.
  - **Pipeline diagnostics are no longer written to a field nobody reads.** `resolve` and `apply` have always produced a structured `Diagnostic[]` — overlapping rewrites dropped, duplicates merged — and every one was discarded. A dropped rewrite is a source mutation that did not happen. Warnings, errors and validation failures now reach the ledger; `info` is skipped, because a ledger reporting routine work is one nobody reads.

  **Two regressions found by measurement, not review**, both worth knowing before touching this again.

  The first: an unconditional follow-on flush **livelocks**. The flush body reaches back into the compiler — `syncGraphs` asks content facets for translations, which can transform, and `transform` schedules a flush — so each run dirtied just enough to justify the next. It presented as a dev server that stopped pushing updates and a contract timing out at 45 s, a long way from where it started. The follow-on now runs only when something is genuinely still unflushed.

  The second was in the runtime, and only a full-suite run under load exposed it: `__zintlApplyHtml` and the `localStorage` write happened **before** a locale switch claimed the active-locale slot, so a switch that was then superseded rewrote `documentElement.lang` anyway. The page rendered Arabic while announcing itself as English, and `locale-switch` and `locale-storm` both caught it. Claim and publish now happen in one synchronous block: claims are ordered, so whichever switch claims last also publishes last, and the document ends up describing the locale the store actually adopted.

  `hmr-hammer` remains intermittently red under full four-worker load with the signature proposal 024 §1.1a records — fewer packets than there were writes. That is the pre-existing failure the proposal measured at roughly one full-suite run in five, and it is upstream of anything here: the loss is a packet the watcher never produced, not one delivered out of order.

- 91662bd: Order and account for every catalog and locale change in the runtime.

  The store had no notion of which delivery was newer, so a slow one could overwrite a fast one that started later, and a failed one left no trace. Seven defects, all confirmed in source:

  - **Locale cross-filing.** `loadLazyBoundary` and `registerLoader` called the loader with `this.locale` captured at call time, then filed the result under `this.locale` read _after_ the await. A switch landing mid-load stored one language's strings under another language's key. Both now capture once.
  - **Overlapping locale switches.** Two switches each wrote `this.locale` and each notified, so the final state was decided by whichever set of promises happened to settle last. A switch now claims the store's active-locale slot and, after awaiting, checks it still holds it; an overtaken switch settles `superseded` and stays quiet.
  - **The in-flight drop.** A concurrent request for a boundary already loading hit `if (pendingBoundaries.has(id)) return;` and was handed `undefined` — no promise to await, nothing to supersede, and a caller that believed it had started a load. It now joins the in-flight promise.
  - **Three abandonment paths** — empty result, rejection, synchronous throw — each now settles `failed` with a reason. Deliberately still no retry: retry cannot fix ordering, and converts a loud failure into a slow one.
  - **`pendingPromises` leaked in the browser.** The server drains it to gate stream injection; nothing drained it client-side, so a long-lived page retained every lazy load it ever performed.
  - **Subscriber isolation.** `listeners.forEach((l) => l())` meant one throwing subscriber silently cancelled every subscriber registered after it.
  - **`_t`'s browser branch** deferred the load into a microtask and never re-read, so the first render tick after a hot update registered a new loader always returned `""` even when the strings were available on that very tick. It now mirrors the server branch, which already had the re-read.

  **The settle beacon changes meaning.** `globalThis.__zintl_version` used to advance only when a catalog value actually differed, so an idempotent redelivery advanced nothing — making "applied, unchanged" indistinguishable from "lost", which is precisely what an observer must be able to tell apart. It is now derived from delivery outcomes and counts every terminal outcome, including `superseded`: an observer asks "has the store finished with my change?", and `superseded` is a finished answer. Subscribers are a separate concern and still only run on real change. Anything asserting a specific beacon delta will need updating; anything asking "did something settle?" is unaffected.

  A development-only ledger is published at `globalThis.__zintl_ledger` as a bounded ring.

  Production carries only what makes an ordering decision: `mint`, `accept` and `holds` ship; `settle` compiles to an empty shell. Guarding `settle`'s _body_ turned out to be insufficient — the argument expressions still evaluated, so `"overtaken by seq " + prior` was doing string concatenation in production bundles. Guards now enclose the calls. The failure reporter also became a free function rather than a method, because as a method it compiled to a closure allocated per load returning `(reason, err) => {}`. Verified: zero delivery identifiers across every example's client bundle.

  Two specification corrections that only surfaced in implementation, now in `docs/spec/ZDB.md`: `runtime/catalog` is keyed by `<locale>/<boundaryId>`, not boundary alone, because a boundary's Arabic and French catalogs are separate deliveries; and `runtime/locale` has exactly one subject rather than one per locale, because the contested resource is the active-locale slot. The rule both illustrate: **the subject is the resource being contested, not the value being delivered.**

### Patch Changes

- 69fed7f: Give written artifacts an owner, and stop the test scratch trees growing forever.

  The author's account of this class was "a very little ones just shock the system and live for ever in a disk category". Two of those were measurable in the repository itself.

  **The test scratch trees.** `createZintlContext` returned a `cleanup` that was an empty function. Every test dutifully awaited it in `afterEach` or `afterAll`, and every run left its directory behind: **5,308 directories, 53 MB**, invisible because `.tmp` is gitignored. A second helper, `createTestDir`, had no cleanup at all and no caller that removed anything, adding another ~20 MB of `html-deep-*` and friends to a different `.tmp` at the repository root. Two independent scratch trees, both unbounded, both hidden.

  A cleanup contract that callers honour and the implementation ignores is worse than no contract — it makes the leak invisible to exactly the people looking for it. `cleanup` now removes the directory, the two helpers share one temp policy, and the base is cleared once per worker on first use so a context whose `cleanup` is never called costs one run rather than every run. Per-worker matters: Vitest runs workers as separate processes against one working directory, so a shared base would let whichever worker started last delete directories the others were still using. Measured across three consecutive full runs afterwards: **40–96 KB, stable.**

  **Pruning consulted a branch that could not run, and would have thrown if it had.** `pruneOrphanedBoundaries` declared a `contentFacets` parameter that its only call site never passed, so the content-boundary protection was unreachable; and the call inside it passed a boundary's metadata where the facet contract declares a `CompilerContext`, so the moment it became reachable it threw `context.getMetadataGraph is not a function`. Two faults hiding each other — dead code does not get to be correct by never running. The facets now come from the field the manager already holds rather than an argument a caller has to remember, and the context is built in the shape the hooks actually read.

  **A prune could be skipped because a counter matched.** The skip key hashed the _size_ of the active content-path set, so swapping one content path for another left it identical and the prune that should have reclaimed the old output never ran. It now hashes the contents.

  **Every write and removal has an outcome.** `safeWriteFile` settles on all three paths — written, skipped as already identical, failed — and `rm` settles too, because an output that vanished and one that was never written look identical on disk. Only the ledger separates them, which is "artifacts outliving their source" in reverse.

  **Pruning in development is named, not enabled.** It is disabled outright for real dev sessions, so a deleted source's catalogs survive the whole session. Turning it on is not a flag flip: `chaos-boundary`'s rename and delete body is commented out behind a "Fix Pruning Left-Over Catalogs on File Deletion" note, which says the reachability question this depends on is still open. Trading an accumulating leak for the chance of deleting a live catalog is much worse, so the staleness gets a name in the ledger instead.

  Also removes two stray artifacts that had been tracked in git since July: an empty `pipeline/task.md` and `pipeline/intent.ts.clean_anchor.txt`.

  **A Phase 3 revision.** The follow-on flush is gone. Its stronger reading of D3 — the caller's own promise resolving when its work lands — cost a full extra flush per hot update, because `runFlush` transforms and `transform` schedules a flush, so every run left a timer that fired afterwards. That timer is now cancelled when nothing is left to flush. What made the original defect a defect was the _destructive clear_, and that fix stays: a mid-flush caller's boundaries survive for the next run rather than being wiped. ZDB §4.3 now says explicitly that deferral satisfies D3 and only destruction violates it.

  **On the measurements.** Contract failures during this work were chased for a while as regressions. They were not: re-running the pre-change baseline under the same conditions produced _more_ failures (8 across five contracts) than the new code (1), because the machine had been running suites back-to-back for hours. This is exactly the trap proposal 024 §7 records — "measure on a quiet machine … that data was worthless and nearly sent the investigation after a phantom". The follow-on removal above rests on the livelock, which is reproducible in a unit test, and on the mechanical fact of the doubled pass; not on the contaminated parallel data. Re-run the gates on a quiet machine before trusting any contract-level conclusion here.

- d3a1100: Make the test harness wait on identity, and put the ledger in every failure.

  **Strict delivery now passes the whole contract suite** — 72/72 under `ZINTL_STRICT_SETTLE=1`, with per-contract exemptions declared rather than assumed. That is proposal 024's third acceptance criterion, which previously had no mechanism to hang on at all: strictness was read straight from `process.env` inside the lab, with no way for a contract to say "I deliberately break the app".

  Exemptions are a **string, not a boolean** — an exemption without a reason is indistinguishable from one nobody revisited. Three are declared: `syntax-recovery` (a compile error _should_ stall the runtime), `chaos-catalog` (deleted and corrupted catalogs _should_ fail to apply) and `chaos-boundary` (deleted and renamed sources). They live on the contract, next to `requires`, so an exemption travels with the thing it exempts.

  **Waits are scaled to what the contract said to expect.** A contract declaring itself exempt has already announced that its writes will not settle — it introduces a syntax error, or deletes a catalog. Waiting the full budget for a stall the contract announced in advance is pure cost: a four-second packet race no packet will end, then a ten-second settle wait for a beacon that will never advance, on every such mutation. Those budgets are now short for exempt labs. Nothing is weakened, because the real gate is the assertion — `textEventually` polls for fifteen seconds either way.

  That, plus deleting the dead two-second teardown sleep, takes the suite from **~119 s to ~72 s**, and collapses its variance: three consecutive runs at 71.4 / 72.5 / 72.1 s, against a previous spread of 78–88 s. The variance mattered as much as the mean — most of it was exempt contracts sitting in timeout loops whose duration depended on machine load.

  An identity-based wait (read the compiler's generation, wait for the page ledger to reach it) was built and then **removed**. It measured no faster than the packet race, it cost a fixed probe on every lab, and it caused a `memory-leak` timeout that needed two follow-up patches. The ledger is where the value actually landed — as diagnosis, below — and a contract that genuinely needs identity-based waiting can read it in about ten lines.

  **Every contract failure now carries the delivery ledger.** Packet counts and a beacon say _how much_ happened; they cannot say which boundary, in what order, or whether anything was superseded or failed — which is the difference between "the update never arrived" and "it arrived and was discarded as older than one already applied". Those have different fixes and used to cost a fresh investigation each. Both ledgers are attached: the page's, and the compiler's, which survives the page and is reachable in project mode where there is no browser at all.

  Three long-standing harness defects fixed in passing:

  - `lab.fs.rename()` fired **neither** mutation hook, so a contract that renamed a file and then asserted on the DOM was racing the dev server with no synchronisation whatsoever.
  - Lab teardown called `ws.waitFor("update", { timeout: 2000 })` immediately after `ws.teardown()` had already restored the original `send`. No listener could ever fire, so it was a guaranteed two-second sleep on every browser lab teardown, dressed as a wait.
  - The five surviving `waitFor({ state: "visible" })`-then-`textContent()` sites are migrated to `textEventually`. That pair looks like it waits but resolves immediately when the element is already visible showing the _previous_ value, so the read races the update — the shape every traced flake came from.

- 2830f35: Make boundary ownership deterministic — the same source compiled to two different graphs.

  `computeTranslationChunks` assigns ownership by walking each chunk root's static tree and keeping whichever root reached a boundary first. The root set came back from `getChunkRoots` in graph-insertion order, so for any boundary reachable from two roots, **iteration order decided the owner**.

  Insertion order is not stable across runs. A compiler starting cold discovers in filesystem-traversal order; one reading a saved manifest gets the manifest's key order, and manifests are written sorted. So whether a previous build had run changed the graph.

  It is directly observable in `react-basic`, whose `main.tsx` holds two nested anchors — `bootstrap` and an anonymous arrow function — both of which statically reach `App`. Warm, `src/App.tsx:App` was owned by `src/main.tsx:bootstrap`. Cold, by `src/main.tsx:f_547`. Both compiles were internally consistent; they simply disagreed, and the disagreement propagated into chunk assignment and four committed graph snapshots.

  Roots are now sorted lexicographically before ownership is assigned. Cold and warm produce identical graphs, and the committed snapshots — recorded warm — remain correct, because `"bootstrap"` sorts before `"f_547"`.

  **ZRS Axiom 4 already required this.** Its rule was stated for circular dependencies while its rationale — "deterministic, reproducible builds regardless of file system enumeration order" — was general, and the general case was where it was being violated. The axiom now says what the code does: wherever ownership is decided by which candidate is reached first, the candidates are ordered lexicographically, never by discovery order. Any first-wins resolution that is not explicitly ordered is an instance of this bug waiting to be found — which is the same rule ZDB Axiom D4 states for facet fan-outs, arrived at from the other direction.

  Covered by `zrs-s4-ownership-determinism`, which feeds the same two roots in both orders and requires one answer. Both of its cases fail without the sort.

- 90dd704: Stop contract runs writing into the committed examples, and add an SSR isolation contract.

  **The per-worker copy was not actually isolated.** `copiedExampleSource` reproduces `node_modules` as a symlink farm that skipped `.vite`, `.cache` and `.vite-temp` — but not `.zintl`, which holds the compiler's persisted manifest. The copy and the real example therefore shared one, and the consequence escaped the test run entirely: a contract that renamed a file wrote a phantom boundary into four examples' manifests, and the next `build:examples` read it back and generated catalogs for source that did not exist — twelve untracked JSON files in the tracked `examples/` tree, from one contract.

  `.zintl` is now **copied** per worker rather than linked. Omitting it was tried first and is wrong for a reason worth recording: a compiler starting cold resolves boundary ownership differently from one reading a saved manifest — `src/App.tsx:App` moved from `src/main.tsx:bootstrap` to an anonymous `src/main.tsx:f_547`, changing four committed graph snapshots. That difference deserves its own investigation, since ZRS Axiom 4 says ownership is deterministic; it is not the copy helper's job to absorb. Copying gives every worker the same warm starting state with no shared mutable file, which is the property the copy exists to provide. Verified by running the offending contract live and confirming `examples/` stays clean.

  This is the same failure the `.vite` comment two lines above already warned about, missed for the same reason it gives: module resolution keeps working perfectly while the state underneath is shared, so nothing looks wrong until an artifact outlives the run that produced it.

  **A new SSR request-isolation contract — marked `pending`, because it was falsified.** The store is request-scoped through `AsyncLocalStorage`, but `getActiveInstance` falls back to the process-global `globalThis.__zintl_active`, and every existing SSR contract issues one request at a time — precisely the condition under which that fallback is indistinguishable from the correct path.

  The contract captures each locale uncontended, then interleaves them and requires every response to still match its own baseline. It passes. To find out whether that meant anything, request scoping was deliberately broken by disabling the `AsyncLocalStorage` lookup; the sabotage reached the served runtime (verified in `dist/runtime/store-core.mjs`, where the bundler had folded the branch away) and **the contract still passed**.

  The reason is the example, not the contract: `react-ssr` renders with `renderToString`, which is synchronous. There is no await between entering the request scope and finishing the render, so no second request can interleave and observe the global. The leak is unreachable here by construction.

  So it ships `pending` rather than green. The assertions and the baseline-then-interleave method are right; what is missing is a **streaming** SSR project — `renderToPipeableStream` with `injectIntoStream`, which the `streamInjection` capability and `store-server.ts` already exist to serve. One fixture away, and then one deleted line.

- 8882138: Add the three unmanifested SSR examples to the contract suite.

  `svelte-ssr`, `vue-ssr` and `vanilla-ssr` existed under `examples/` and were built by `build:examples`, but no contract had ever run against them — SSR coverage was React only. Every SSR-shaped contract now runs across four frameworks: **94 contract tests, up from 76, for about six seconds.**

  That matters most where the frameworks genuinely differ. SSR codegen for Vue and Svelte single-file components goes through different facet paths than JSX, and until now the only thing checking either in SSR mode was a production build with nothing asserting its output. The three new manifests bring `transform`, `build`, `graph` and `boundary-graph` snapshots with them — 99 of them — so a change to SFC handling under SSR is now visible as a diff rather than as a downstream surprise.

  **Their capability lists are deliberately narrower than `react-ssr`'s.** That manifest also claims `hmr`, `locale-switch` and `rtl`, and none of the three matches anything: every contract requiring them also requires `spa`, which an SSR project does not have. Inert claims cost nothing at runtime, but a capability list exists precisely to say what is covered, and one that overstates is the same failure as a contract whose body is commented out. The new manifests claim `ssr`, `boundary-graph`, `transform`, `build`, `graph` — all of which match.

  The manifest index now carries the cost model too, since this is the file where it gets decided: cost is roughly (examples × matching contracts), each manifest also brings a per-worker copy and a pooled dev server, and `fixtureSource` remains the right tool when the question is "does this one feature work" rather than "does this whole app work".

  None of the four streams — all render synchronously — so `ssr-isolation` stays `pending`. Its blocker is unchanged and now better bounded: what it needs is not another SSR example but a _streaming_ one.

- c28c3aa: Add a streaming SSR fixture, and turn the request-isolation contract from unfalsifiable to proven.

  `ssr-isolation` shipped `pending` because it could not fail. Every SSR project in the manifest renders synchronously, which leaves no window between entering the request scope and reading the store — so a request-scoped read and a read of the process-global `globalThis.__zintl_active` are indistinguishable, and the contract would have passed no matter what the runtime did.

  The new `ssr-streaming` fixture supplies the two properties nothing else had:

  - **An `await` inside the render.** One yield between entering the scope and producing translated output, which is the window a second request needs in order to observe the first's state.
  - **A `ReadableStream` return.** `injectBakedCatalogs` routes that through `injectIntoStream` — machinery that ships in every SSR build and had no test touching it at all.

  **Verified by falsification.** With the `AsyncLocalStorage` lookup in `getActiveInstance` deliberately disabled so every read fell through to the process-global, the contract failed on the fixture with **18 of 24 concurrent responses serving Arabic to English, Spanish and Chinese requests** — each one complete, well-formed, and belonging to somebody else. The four example projects kept passing throughout, correctly: they render synchronously and genuinely cannot leak. That split is the evidence the fixture was needed, and `ssr-isolation` is no longer `pending`.

  Two things about the fixture are load-bearing and easy to get wrong. Its translatable strings sit in a **template literal carrying markup**, because that is what the extractor stitches — an earlier version passed the same text as a bare argument to `encoder.encode()` and produced no catalogs whatsoever, so the contract "passed" against a page with nothing to translate. And they are built **after** the yield, since that is where a contaminated read would occur; constructing them earlier would make the fixture look like it exercised the window while proving nothing.

  Translations are seeded per locale so the four render visibly differently. The contract already refuses to run against identical baselines — a leak between locales that look the same is undetectable, and a test that cannot distinguish them should say so rather than report green.

  Suite: 100 contract tests, ~72–74 s.

- 1e25c60: Strengthen the contract suite, and stop one contract claiming coverage it does not have.

  **Two new contracts, both asserting in a real browser.** The distinction matters more than it sounds: the runtime is served as _text-substituted source_ through `getRuntimeCode`, and the one time a guard could not be folded, every development branch in the browser was dead for the project's entire life while every unit test passed. A rule that only holds against a bare `I18nStore` is not a rule that holds.

  - **Delivery Ordering** proves Axiom D1 the way `hmr-hammer` cannot. `hmr-hammer` can only observe the order the network happened to produce; it can never make an older catalog arrive _after_ a newer one. This one does, and asserts the older loses — and that it loses _by rule_, with the supersession recorded, since a correct result reached by accident is indistinguishable from one reached by rule and does not survive the next change. It asserts on the store rather than the DOM, deliberately: whether a framework re-renders is a different question with its own contracts, and asserting it here would report their failures as ordering failures.
  - **Delivery Failure** is proposal 024's acceptance criterion 2 — an abandoned boundary is observable. It exercises all three abandonment paths (rejection, empty result, synchronous throw) and requires each to be named in the ledger _with a reason_, because "it failed" and "it resolved empty" call for different fixes. It also asserts the page survives: a failed lazy boundary is not a crash.

  **`assert.localeCoherent()`** checks that the store and the document agree about the locale. `assert.locale()` only ever read `html[lang]`, so a page rendering Arabic while announcing English passed it — which is precisely the defect a superseded locale switch produced when it was still allowed to publish. Both halves were individually plausible; only their disagreement was the bug. Wired into `locale-switch` and `locale-storm`.

  **A contract can now declare itself `pending`.** `chaos-boundary` had its entire body commented out behind a known blocker, so what it actually ran was `navigateHome` plus one heading assertion — an exact duplicate of `initial-render`, reporting green and claiming the `chaos` capability while covering none of it. That is the worst state a test can be in: it occupies the slot where the real coverage would go and tells everyone the slot is filled. It is now skipped with its reason in the test report. A visible gap beats a passing test that hides one.

  **One assertion was written, measured, and removed** — worth recording because it looked rigorous and was wrong. `hmr-hammer` briefly asserted that the wire carried one packet per write. It failed on every project: 3 packets for 5 writes, consistently, while the DOM converged correctly every time. The conclusion is not that delivery is broken but that the invariant was false. **Coalescing rapid writes is correct** — two writes 30 ms apart may legitimately become one event, provided it carries the later content. Proposal 024 §1.1a is narrower than "fewer packets than writes": it is coalescing dropping the **final** state. That is what the convergence assertion already tests, and counting packets would only add a red that means nothing.

  Suite: 76 contract tests (from 72), still ~73–82 s.

  - @zintljs/extractor@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- 60517d0: - Add branding assets.
  - Update README files with improved logo branding and unified shield badges.
  - @zintljs/extractor@0.1.0-alpha.9

## 0.1.0-alpha.8

### Minor Changes

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

### Patch Changes

- fcd99bf: Report catalog-delivery failures instead of swallowing them.

  `loadLazyBoundary` discarded every failure mode it had: a rejected promise (`.catch(() => …)`), an empty result (`if (!res) return;`), and a synchronous throw (`catch {}`). All three cleared `pendingBoundaries` and scheduled no retry — so once delivery failed, `_t` returned `""` for every key in that boundary permanently, and nothing anywhere recorded why.

  An empty string is not a missing fallback; it is a read that returned the wrong value. The compiler's integrity check guarantees catalogs are complete, so a miss at runtime means _delivery_ failed, not content — and blank UI with no trace is the worst possible way to express that.

  All three sites now report in development, naming the boundary, the locale, and the consequence. Behaviour is otherwise unchanged: no fallback, no retry, no recovery invented. This makes a silent wrong-value read a loud one.

  Worth noting why this was never seen: the only diagnostic in the whole path was a `console.warn` gated on the old `typeof process !== "undefined"` guard, which never evaluated true in a browser. Client-side, this failure mode has been invisible for the project's entire life.

  Production output is unaffected — the logging is behind `__ZINTL_DEV__` and is eliminated at build time (verified: no such strings appear in any `dist` snapshot).

  - @zintljs/extractor@0.1.0-alpha.8

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
  - @zintljs/extractor@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- 2a07272: Introduced a modular, conflict-free **Adapter Architecture** that decouples framework-specific and toolchain-specific capabilities into discrete concerns. Framework presets (`"react"`, `"vue"`, `"svelte"`, `"vanilla"`, `"html"`, `"nextjs"`) and runtime/bundler layers (`"ssr"`, `"vite"`, `"client-spa"`) compose dynamically into a resolved capabilities map. Key changes include:

  - **Environmental Runtime Splitting**: Decomposed `store.ts` into environment-gated modules (`store-core.ts`, `store-client.ts`, and `store-server.ts`). Vanilla applications now bundle only core translation states, while SPA router synchronization popstates and server request-scoped `AsyncLocalStorage` logic are loaded dynamically on demand.
  - **Vite Plugin Decoupling**: Refactored the Vite plugin config hook to utilize the compiler's presets engine, auto-injecting the `"vite"` preset and detected frameworks, which cleans up hundreds of lines of duplicate codegen and SSR wrapper regexes.
  - **Extension Preservation**: Retained full source file extensions (like `.tsx`, `.jsx`, `.svelte`, and `.vue`) in the boundary ID normalization and compiler maps to prevent naming clashes between files sharing the same base name.
  - **Boundary & Catalog Alignment**: Resolved a bug causing duplicate catalog and schema files (e.g. `App.ar.json` vs `App.svelte.ar.json`) by passing pre-resolved extensions and adapters directly to the `IOManager` constructor to unify normalized paths.
  - **Backward Compatibility**: Embedded fallback translation from `options.targets` to their preset adapters to ensure full compatibility with existing configuration blocks.

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
- 448dbc6: Made `@zintljs/extractor` genuinely framework-blind. A previous changeset claimed the extractor had been "fully decoupled" from framework presets; that was inaccurate — the tables were left in place, duplicating the facet presets, and one of them was still on a live code path.

  **Deleted from `targets.ts`:**

  - `TARGET_PRESETS` — full descriptor lists for `vanilla`, `react`, `nextjs`, `vue`, `svelte` and `html`.
  - `TARGET_METADATA` and the `TargetMetadata` type — Vue and Svelte SFC block rules, Svelte's mustache pattern, and the Next.js `generateMetadata` / `generateViewport` suppression rules.
  - `DEFAULT_SFC_RULES` and `DEFAULT_SUPPRESSION_RULES`.

  Every one of these duplicated a facet preset in `@zintljs/compiler/facets`, which is now the single source of truth. The Vue and Svelte block rules were byte-identical to their preset counterparts.

  **Removed the one live leak.** `parser.ts` fell back to `DEFAULT_SFC_RULES` whenever the caller's rules did not cover a file's extension, so any `.vue` or `.svelte` file received Vue/Svelte block-splitting from the extractor itself even when no rules were supplied. SFC rules are now caller-supplied only.

  **`TargetDescriptor` no longer names a framework.** The `"auto" | "react" | "nextjs" | "vue" | "svelte" | "html" | "vanilla"` members are gone, leaving only the structural forms (`jsx:*:attr`, `jsx:El:attr`, `dom:prop:x`, `dom:attr:x`, `obj:field:x`, `html:attr:x`) and `TargetPlugin`. `resolveTargets` is correspondingly reduced to pure structural compilation — descriptors into lookup sets, plugin collection and a fast-path regex — with no preset expansion and no rule derivation.

  **No default target set.** `parser.ts` and `context.ts` both defaulted to `["vanilla", "react", "html"]`. A framework-blind executor has nothing sensible to guess, so callers now declare their sinks; production supplies a fully compiled state from the resolved facets.

  **Removed dead sink opinions.** `DEFAULT_UI_ATTRIBUTES`, `DEFAULT_UI_OBJECT_FIELDS`, `DEFAULT_UI_SINK_PROPERTIES` and `TEMPLATE_ATTR_REGEX` encoded which DOM and JSX attributes are translatable. All four were already unreferenced — one survived only inside a commented-out line.

  **Fixed drifted runtime-specifier detection.** The check for Zintl's own module specifiers was inlined at four sites (`parser.ts`, two in `visitors/program.ts`, one in `visitors/bindings.ts`) and the copies had diverged: the `bindings.ts` variant omitted the bare `"zintl"` literal, so a project configuring a custom `runtimePackage` would have had bare `"zintl"` imports recognised by three checks and missed by the fourth. All four now call the new `isRuntimeSpecifier` helper, backed by a single `RUNTIME_SPECIFIERS` list.

  **Verification.** The contract snapshots passed with zero diffs, which is the proof that the deleted tables were dead in production. Three new architecture tests assert that the extractor names no framework anywhere in its source, exposes no preset tables, and that `resolveTargets([])` yields a genuinely empty world.

- e1e504d: Prepare the packages for their first public release.

  - **Renamed the npm scope** from `@zintl/*` to `@zintljs/*`. The `zintl` org name was unavailable on npm; the primary package remains `zintl`, so application code importing `zintl` and `zintl/macro` is unaffected. Only direct consumers of `@zintl/compiler` and `@zintl/extractor` need to update.
  - **Corrected the Vite peer range** to `^6.0.0 || ^7.0.0 || ^8.0.0`, verified by building a real app against stock Vite 6.4.3, 7.3.6, and 8.2.0. The plugin relies on the Environment API (`hotUpdate`, `this.environment`), which does not exist in Vite 5, so the previous `^5.0.0` range advertised support that could never work.
  - **Pinned `oxc-parser` and `@oxc-project/types`** to `^0.142.0` in the workspace catalog. They were set to `latest`, which would have published `@zintljs/extractor` with an unpinned runtime dependency on a pre-1.0 parser.
  - **Trimmed the publish surface** with an explicit `files` field. The `zintl` tarball drops from 91 files (535 kB unpacked) to 13 files (103 kB) — build config and sources are no longer shipped.
  - **Added `engines`, `repository`, `homepage`, `bugs`, and `keywords`** to every published package, and gave `@zintljs/compiler` and `@zintljs/extractor` their own READMEs.
  - **Moved npm provenance out of `publishConfig`** so that publishing is possible outside of CI. Provenance requires a public source repository and CI OIDC; it is re-enabled via `NPM_CONFIG_PROVENANCE` in the release workflow.
  - **Marked `@zintljs/testing` as private.** It backs the internal e2e suite only and is no longer part of the release surface.

- 3fa4428: Hardened catalog reconciliation — the subsystem that decides, when source text changes, whether a translation is carried forward or dropped. Because keys derive from the text itself, this is what makes ordinary copy edits safe, and it had three unit tests.

  **Its two failure modes are not symmetric, and the design now says so.** A _missed_ rename is cushioned: the translation hive is append-only and keyed by source text globally, so the old translation is never destroyed and `CatalogManager` restores it if that text reappears. A _wrong_ rename is not cushioned — the old translation is written under the new source text and then memorized into the hive, so one bad match propagates. Everything below follows from that asymmetry.

  **Carry-forwards are now reported.** `ReconcileResult` gains a `renamed` array recording every rename with its similarity score and a `substitutesWords` flag, and `MessageManager` surfaces them: a warning when a whole word was swapped, debug otherwise. Deletes stay quiet, because the hive already covers them.

  The flag is a risk signal, never a rejection. Edit distance cannot separate `"Enable notifications"` from `"Disable notifications"` — they are ~0.86 similar — and no threshold can, since a negation and a spelling fix are the same edit size. But a negation _substitutes a word_ while a typo fix, a punctuation change or an appended clause does not, so that shape is worth a developer's eyes. A single-word spelling fix (`"Colour"` → `"Color"`) trips it too; it still reconciles, it is just visible.

  **Matching is deterministic.** Renames were assigned by walking removed texts in manifest order and taking each one's best available partner. When two removed strings competed for the same partner, iteration order decided which kept its translations. Candidate pairs are now scored globally and assigned best-first, with ties broken on text, so the outcome is a pure function of manifest _content_ rather than ordering — and the greedy result is strictly better matched.

  **Short strings no longer fall off a cliff.** Similarity is length-relative, so `"OK"` → `"Ok"` was one edit over two characters — 0.5, under the 0.6 threshold — and a casing fix on a two-letter button was classified as a delete. The new `isRenameCandidate` applies a one-edit floor. This only ever relaxes the budget, and only where the ratio rounded below a single edit, so nothing three characters or longer changes behavior.

  **Separated two thresholds that had been conflated.** The assets facet's fuzzy matching now uses its own `DEFAULT_ASSET_DRIFT_THRESHOLD` rather than borrowing `DEFAULT_RENAME_THRESHOLD`. One asks "is this the same UI string, edited?" over short labels; the other asks "did this document change materially?" over whole file bodies. They share a value today and are now free to diverge.

  **Tests went from 3 to 26**, and are grouped around the asymmetry: the short-string budget, word-substitution reporting, and a property block covering classification exhaustiveness (every removed text lands in exactly one of rename/move/delete), invariance under manifest and boundary ordering, one-partner-per-text, closest-partner preference, no-op on unchanged manifests, and similarity symmetry.

### Patch Changes

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

- 51261a9: Decoupled static asset localization (`AssetManager`) and HTML catalog/schema projection (`HtmlManager`) from the hardcoded execution paths of the compiler. Created the generic `ContentAdapter` interface and a stable `CompilerContext` API, migrating the manager behaviors into pluggable system content adapters (`staticAssetsAdapter` and `htmlProjectionAdapter`).
- 7e02023: Fully decoupled the remaining hardcoded knowledge of assets and HTML projections below the adapter resolution layer. Refactored `CatalogManager` and `GraphManager` to genericize virtual boundary tracking and content checks via resolved content adapter hooks, eliminating direct imports and usage of manager classes in the compiler core.
- 3fd61d3: Ensure deterministic boundary and chunk graph serialization by implementing deterministic sorting helpers:

  - **Deterministic Serialization**: Added the `serializeDeterministic` utility to recursively format and sort `Map` keys, `Set` elements, and arrays of objects (such as `BoundaryDep` lists) by stable properties (e.g. `id` or `name`).
  - **Strict ESLint Compliance**: Included a localized string comparison helper `compareStrings` to satisfy array sort checks without the performance overhead of Unicode-based `localeCompare`.
  - **Contract Tests Snapshot Stability**: Updated the contract graph test suite to utilize the new deterministic serializer, preventing random reordering failures on successive test runs.

- a7f080f: Fully decoupled high-level framework presets (`"vue"`, `"svelte"`, and `"nextjs"`) from `@zintljs/extractor`'s core logic. The extractor has no hardcoded references to these framework target-presets, meaning all SFC block parsing rules, metadata suppression rules, and mustache regular expression patterns now flow downward from compiler-resolved adapters.

  Evolved the extractor's mustache rule matcher to dynamically match intermediate or virtual file extensions (e.g. `.vue.html` and `.svelte.html`) to ensure correct template variable extraction and production catalog baking in Vue and Svelte.

- fdda8fa: Refactored the compiler and Vite plugin wrapper to establish a fully adapter-driven modular architecture. Eliminated hardcoded fallbacks for extensions in the plugin wrapper config resolved hooks. Preserved physical JSON catalog formats for robust schema-enforcements, auto-healing, and recovery. Added support for custom Handlebars SFC template block extraction and dynamic runtime multi-brand slogans resolution, utilizing robust regex rewriter hooks. Added type definitions for SFC identification on codegen contributions. Unified the HTML projection preset adapter with the compiler's extraction manifest to merge standard extracted text keys and metadata (such as titles, descriptions, and directions) into the generated schemas, resolving validation conflicts under `additionalProperties: false`.
- 72acaa8: Expanded SSR entry point file extension matching in the compiler presets to support JSX/TSX:

  - **SSR JSX/TSX Entry Wrapping**: Added support for `.tsx` and `.jsx` file extensions when detecting and wrapping server entry points inside `runInRequestScope` in the `ssr` and `nextjs` presets.

- Updated dependencies [448dbc6]
- Updated dependencies [a7f080f]
- Updated dependencies [e1e504d]
  - @zintljs/extractor@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- 3ceeaf3: Upgrade the Zintl compiler to fully support backing up, restoring, and similarity matching (fuzzy reconciliation) of static translation assets in the global Hive:

  - **Move & Rename Auto-Recovery**: Stored asset targets indexed by their source content hash (`@zintl/asset-hash:<sha1>`) instead of absolute paths. This allows automatic translation restoration at the new location when a source asset is moved or renamed.
  - **Binary/Image Asset Backups**: Implemented Base64 encoding/decoding to safely back up localized binary assets in `hive.json` and restore them back as raw binary buffers.
  - **Target Pruning**: Updated the asset manager to proactively delete localized target files from disk when their source asset is deleted or moved, working seamlessly in development/HMR mode.
  - **Fuzzy Modification Reconciliation**: Implemented Levenshtein-based similarity matching for text and Markdown assets. If a source asset changes slightly (either at the same path or during a move), Zintl now preserves the translator's existing translation and prepends a review warning rather than overwriting it entirely.

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

- 7dd0bfb: Fix HMR script injection for Vue and Svelte SFC components. The compiler now detects the closing `</script>` tag in single-file components and embeds the HMR acceptance code block inside it instead of appending it raw at the end of the file, preventing template syntax compilation errors.

  Additionally, Zintl now injects a dynamic boundary HMR revision token comment in development mode for transformed components. This forces SFC compilers (like Svelte) to generate a modified signature upon catalog invalidation, prompting Svelte's HMR proxy to correctly swap and re-render component instances when translation catalogs change.

- 372448e: Fixed HMR updates for shared and lazy components by resolving entry manager chunks through boundary graph reachability traversal:

  - Updated `getAffectedChunks` to map safe/sanitized boundary IDs back to their physical files.
  - Performed depth-first reachability search to correctly track and invalidate entry managers for any component containing translations.

- f7ee691: Fix compiler caching of boundary environment registrations in SSR setups. Boundaries are now tracked and added to `ssrBoundaries` or `clientBoundaries` on every transform call, bypassing the compile-time AST observation cache. This prevents false-positive "server-only" HMR reload events during client-side hydration.
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

- Updated dependencies [85504fe]
- Updated dependencies [0bd00a8]
  - @zintl/extractor@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- 365d1d2: Fixed boundary resolution and dependency reachability for exported bindings and entry point content modules.

  - Registered candidate boundaries defined in `exportedBoundaries` (e.g. `src/main:createApp`) into the compiler's boundary graph, ensuring that static reachability traversal chains are not broken by named exports.
  - Expanded entry-point content catalog generation (for target locales like `ar`, `es`, `zh`) to always inline and collect all statically reachable boundaries, aligning their structure with the manager's source locale catalog.

- a6ab4f6: Fixed SFC extension normalization in chunk and metadata resolution. Standardized metadata lookup in `getMeta` to resolve `.vue` and `.svelte` files and aligned internal path normalization to only strip JS/TS source extensions (preserving Vue/Svelte extensions), preventing empty catalogs for SFC-level anchors.
- 365d1d2: Fix production SSR client hydration mismatch and Vue SFC multiplex caching:

  - Virtualize Vue and Svelte SFC paths by locale (e.g. `HelloWorld.zintl-ar.vue`) in `resolveIdHook` and `loadHook` to prevent descriptor caching collision in the SFC compilers.
  - Normalize localized virtual SFC paths back to clean original paths in `packages/compiler/src/managers/IOManager.ts`.
  - Allow relative imports within virtualized `.zintl-` SFCs to propagate their locale and get virtualized rather than returning raw clean paths immediately.
  - Skip processing Vue and Svelte virtual sub-requests in `loadHook` and `transformHook` to prevent overriding pre-compiled blocks with raw template blocks.
  - Trim catalog key matching and variable mustache lookups with padding preservation in the compiler pipeline to ensure translations match and preserve leading/trailing whitespace.

- Updated external dependencies:
  - @formatjs/icu-messageformat-parser@^3.5.10
  - @types/node@^24.12.4
  - magic-string@^0.30.21
  - typescript@^5.9.3
- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.4

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

- Updated dependencies [776aca8]
- Updated dependencies [18a7166]
- Updated dependencies [776aca8]
  - @zintl/extractor@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Introduce universal target presets, configurable assets mapping, and testing suites:

  - **Target Preset Customization**: Added framework target presets (`react`, `vanilla`, `html`) and a Target DSL in the extractor, allowing developers to configure translatable attributes, sinks, and object property targets.
  - **Universal Asset Targets (`assetsTarget`)**: Added support in the compiler for glob-based asset routing configurations, supporting strategy overrides (such as binary pass-through, text pass-through, frontmatter) and custom strategy callbacks.
  - **Catalog Group-by Path Routing**: Grouped asset catalogs by locale and original relative paths to prevent collisions across multiple files sharing identical basenames.
  - **Testing Verification**: Created dedicated unit test suites covering targets preset expansion, Target DSL parsing, resolver caching, extractor targets integration, and custom asset strategy callback execution.
  - **Decoupled Reference Calibration**: Decoupled the benchmark calibration step from extractor implementation, running it as a pure JS mathematical loop to stabilize execution speed measurements and prevent false budget regression alerts.

- Updated dependencies
- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Rebranded the primary Vite plugin package from `@zintl/vite` to `zintl` to serve as the unified main entry point. Updated the compiler import resolution pipelines, extractor AST visitor patterns, configurations, and example imports to resolve and load from `zintl` and `zintl/macro`.

### Patch Changes

- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `@zintl/vite/macro` has been streamlined as a lean, zero-dependency facade.
- be116c3: **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🟢 1 benchmark(s) improved (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                         | Baseline | New Run                        | Calibrated Delta | Status    |
  | :-------------------------------- | :------- | :----------------------------- | :--------------- | :-------- |
  | Colony HMR Latency (Manager Sync) | 415.9 µs | 391.0 µs (385.2 µs calibrated) | -7.38%           | 🚀 Faster |

### Patch Changes

- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.0

## 0.0.3

### Patch Changes

- be116c3: **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🔴 1 benchmark(s) regressed (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                         | Baseline  | New Run                          | Calibrated Delta | Status       |
  | :-------------------------------- | :-------- | :------------------------------- | :--------------- | :----------- |
  | Extractor Baseline (Full Project) | 1010.9 µs | 1064.4 µs (1075.7 µs calibrated) | +6.41%           | ⚠️ Regressed |

- Updated dependencies [d2d7d9b]
  - @zintl/extractor@0.0.3

## 0.0.2

### Patch Changes

- Optimize compiler pipelines to handle collapsed phrasing tag mappings:
  - **Deduplicated Pipeline Support**: Propagates deduplicated tagMaps through the observation, rewrite, and baking pipelines to align with normalized phrasing tag configurations.
- Updated dependencies
  - @zintl/extractor@0.0.2

## 0.0.1

### Patch Changes

- Fix and optimize compiler HMR, variable shadowing, and generalized page fanning:

  - **HMR Optimization**: Streamlined file caching and fanning checks in the transform pipeline to avoid redundant physical reads during normal dev/HMR fanning, lowering HMR warm-path latency to under `0.002ms`.
  - **Generalized HTML Page Fanning**: Removed hardcoded `index.html` fanned-out catalog generation bounds, fully supporting arbitrary HTML subpage fanning (e.g. `about.html`) with correct `lang`/`dir` metadata.
  - **Variable Shadowing Resolution**: Renamed overlapping `meta` definitions in the HTML projection engine to prevent silent `TypeError`s, fully restoring `deltas` and `rtl` switcher scripts.

- Updated dependencies
  - @zintl/extractor@0.0.1
