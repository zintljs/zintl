# Proposal 026 — Leak Ledger

**Companion to** [026-rsbuild-as-falsification-harness.md](026-rsbuild-as-falsification-harness.md). Read §4.2 (the three buckets) and §5.5 (write it as you go) before adding to this file.

One entry per leak. Every entry records **what failed**, **the assumption behind it**, **the bucket**, **the fix or the deferral**, and **whether the facet contract had to change**. An entry written from memory after the fact is the failure mode §8 names as most likely; entries here are written in the same session as the work.

Per §6.6, anything **inferred rather than reproduced** is marked `INFERRED`. A confident wrong entry costs more than an honest gap.

**Bucket key** (§4.2): **1 = facet it** · **2 = relocate it** · **3 = delete the guess**.

---

## Phase 0 — leaks structurally forced before installing Rsbuild

These three were found by reading the **installed** `unplugin@3.3.0` source rather than by inspection of our own code, so they are harness-driven despite predating the harness. §1's objection to audit passes does not apply: something did disagree with the assumptions, it just did so in `node_modules` instead of in a test run.

### L-001 — Compiler construction is wired to a Vite-only hook

|                             |                                    |
| :-------------------------- | :--------------------------------- |
| **Status**                  | Fixed                              |
| **Bucket**                  | **2 — relocate**                   |
| **Facet contract changed?** | Yes — introduces `BundlerHostView` |

**What failed.** Nothing yet, on Vite. Found by reading unplugin's target adapters: `getRspackPlugin` / `getRsbuildPlugin` consume only `resolveId`, `load`, `transform`, `buildStart`, `buildEnd`, `watchChange`, `writeBundle` and the `rspack`/`rsbuild` escape hatches. **Everything inside a plugin's `vite: {}` block is dropped**, silently and by construction.

`plugin.ts:66-73` puts six hooks there, and one of them — `configResolved` — was the only place `ctx.compiler` was ever assigned (`hooks/config.ts:113`). So on any non-Vite host the plugin loads, registers its hooks, and then throws on `undefined` at the first `resolveId`.

**The assumption.** _"There is a configuration phase, and it happens before anything else."_ True of Vite, true of Rollup, and not true of a host reached through unplugin's universal surface — where `buildStart` is the first hook that runs.

**The fix.** `detect → assemble → resolve → construct` moved to `packages/zintl/src/host.ts` behind `ensureCompiler(ctx, host)`, idempotent. `configResolvedHook` shrinks to translating a `ResolvedConfig` into a `BundlerHostView` and calling it; `buildStart`, `resolveId`, `load` and `transform` call it defensively with `fallbackHostView()`. On Vite `configResolved` still runs first, so the real host view always wins and behaviour is unchanged.

**Note.** `ViteDriver.compile()` (`packages/testing/src/environment/vite-driver.ts:48-62`) already ran this exact sequence with no bundler present, and had done so for some time. The capability to construct a compiler host-free existed; only the plugin did not use it. A second implementation of a sequence is a reliable smell that the first one is in the wrong place.

---

### L-002 — Multiplex propagation is a graph traversal delegated to the bundler's resolver

|                             |                                                |
| :-------------------------- | :--------------------------------------------- |
| **Status**                  | Fixed                                          |
| **Bucket**                  | **2 — relocate** (see the split verdict below) |
| **Facet contract changed?** | No                                             |

**What failed.** `resolveIdHook` propagated a locale across import edges by asking the bundler to resolve each edge and then deciding, inline, whether the target was "translation neutral" — via a 58-line closure (`hooks/resolve.ts:172-229`) reaching into `metadataGraph`, `internalManifest` and `dependencyGraph`. It needed `this.resolve(id, importer, { skipSelf: true })` to do it.

**The Rspack reality is not "different", it is "absent".** The Rspack `UnpluginBuildContext` (`unplugin/dist/context-D3KUBasH.mjs`) has exactly five members:

```
getNativeBuildContext · addWatchFile · getWatchFiles · parse · emitFile
```

There is no `resolve`. The strategy cannot be ported, only replaced — which is what §4.1 predicted and is the single most valuable thing this exercise was expected to produce.

**The assumption.** _"To find out whether a module matters, ask the bundler to resolve it and then inspect it."_ The compiler had already analysed every one of those modules and built a graph describing them.

**The fix.** The traversal moved into `GraphManager.hasTranslatableContent`, wrapped by a new public `ZintlCompiler.isTranslationNeutral(fileId)`. `resolveIdHook` now asks one question and applies the answer.

**§9 Q2 — answered, partially, and negatively for the strong version of the claim.**

> _Can the multiplex plan be computed entirely from the compiler graph ahead of resolution?_

**No — not entirely.** The graph is keyed by normalized **file ids**, so a bare or aliased specifier (`react`, `@/components/Button`) has to become a path before the graph can be asked about it. Module resolution — `node_modules` lookup, `exports` maps, `tsconfig` paths, bundler aliases — is genuinely the host's job and no static graph supplies it.

But the residue is _much_ smaller than the code implied: it is one resolution per edge, not a traversal per edge. Everything downstream of "which file is this" is now the compiler's. The portability claim survives in the form that matters — a bundler facet **applies** id rewrites rather than rediscovering which are needed — and fails only in the form nobody needed, that the plan could be computed with no host involvement at all.

**Two sub-findings worth their own lines:**

**L-002a — `leadsToBoundary` is not the predicate this needed.** `INFERRED` at plan time, **falsified on contact.** The plan recorded that `GraphManager.leadsToBoundary` "returns precisely the three facts a multiplex plan requires". It does not. It answers _"does this file reach a trust anchor"_ — a question about **locale ownership** — by checking `anchorSites.length > 0 || hasZintlMarker` (`GraphManager.ts:595`). The multiplex question is _"does this file reach translatable content"_ — a question about **payload** — which additionally requires `hasZintlMacro`, `needsLoader` (itself `sinks.length > 0 || manualTranslations.length > 0`, `index.ts:1142`) and non-empty `internalManifest` entries.

The common case separates them: a plain component holding strings, declaring no anchor, answers **false** to `leadsToBoundary` and **true** to the multiplex question. Swapping one for the other would have silently dropped that component's translations — a bug that no type error and probably no snapshot would have caught, because the two functions have near-identical signatures and plausible names.

Hence a **new** method rather than reuse. Recording this because "two predicates that look interchangeable and are not" is exactly the shape of defect this ledger exists to catch, and because the plan asserted the opposite with confidence.

**L-002b — the walk stops at extensionless imports.** `DEFERRED — separate defect.` The relocated traversal resolves a relative dependency as `getNormalizedId(join(dirname(owner), depId))`. For `./counter` that yields `src/counter`, which matches no key in `metadataGraph`, `internalManifest` or `dependencyGraph` — so the walk terminates and the file is reported translation-neutral. `GraphManager.resolveDependencyFileId` (`GraphManager.ts:35-57`) already solves this by trying each known extension, and is used by every other traversal in that file.

Not fixed here, deliberately: the move was kept byte-for-byte behaviour-preserving so that "the Vite path is unchanged" is a claim about the diff rather than about a test run. Fixing it makes _more_ modules multiplexed — the conservative direction, so likely a real bug fix — but it needs its own evidence and its own snapshot review.

---

### L-003 — The static extension allow-list

|                             |                          |
| :-------------------------- | :----------------------- |
| **Status**                  | Fixed — deleted          |
| **Bucket**                  | **3 — delete the guess** |
| **Facet contract changed?** | No                       |

**What failed.** `hooks/resolve.ts:157-160` gated multiplex propagation on a hardcoded list:

```ts
["js", "jsx", "ts", "tsx", "md", "txt", "vue", "svelte"].includes(ext);
```

**The assumption.** _"These are the extensions that might contain strings."_ Wrong for any app, including Vite ones (§4, last row): a Vue-only app pays for `.svelte`, and a project adding a templating extension via a facet is silently skipped despite the facet declaring exactly which extensions it claims.

**The fix.** Deleted, not relocated. §4.1 predicted this precisely — the question stops being "might this file contain strings" and becomes "does my graph place this module inside translated content", which L-002 now answers. Nothing took its place.

Worth stating because §4.2 warns bucket 3 is systematically under-found: a facet-shaped answer _was_ available here and would have looked like progress. `CompilerSystemView.extensions` is facet-derived and unioned (`facets/resolve.ts:200-238`), and moving the list there would have been defensible. It would also have been wrong — it would have preserved a pre-filter whose only remaining job was to guess at what the graph already knew.

---

## Phase 1 — the harness, proven in isolation (§6.5)

A throwaway unplugin plugin — one `transform`, one virtual module, two emitted assets — built under Rsbuild `2.1.10` before Zintl was pointed at anything. Deliberately noisy: it logs what each hook is handed, because that is the baseline every later trace is measured against.

**It builds, and the output is correct**: the transform applied, the virtual module resolved and loaded, both assets emitted. So Tier 1 (ZDB §7a) is reachable on this host — the failures from here on are ours, not "we are holding Rsbuild wrong".

Everything below is **reproduced**, not inferred. Reproduction lives in `.tmp/spike-026/hello-rsbuild/` (gitignored, throwaway, installed outside the workspace so `vpr verify` and `knip` are untouched).

### L-004 — `\0` survives `resolveId`→`load` but **not** `transform`

|                             |                                                       |
| :-------------------------- | :---------------------------------------------------- |
| **Status**                  | Open — no fix attempted yet                           |
| **Bucket**                  | **2 — relocate** (provisional)                        |
| **Facet contract changed?** | Likely — needs an `isVirtualId` question core can ask |

**What happened.** The same virtual module is presented to two hooks under two different identities:

```
load      called with id: "�virtual:spike/greeting"
transform called with id: "/…/node_modules/.virtual/%00virtual%3Aspike%2Fgreeting"
```

`resolveId` returned `"\0virtual:spike/greeting"` and `load` received it back **verbatim**. But unplugin materializes non-existent ids into a real file under `node_modules/.virtual/` with the id percent-encoded into the filename, and it is that path which reaches `transform` and the module graph.

**Correction to an earlier reading.** Before running anything, the Phase 0 notes recorded that virtual module identity "stops being an opaque string and becomes an absolute path inside `node_modules/`". That is half right and the half matters: it is true at the `transform` boundary and in the module graph, and false at the `resolveId`/`load` boundary. The `\0` convention is not simply unavailable on Rspack — it is available in two of the three places Zintl uses it. A fix that assumed uniform loss would have been wrong.

**Why it has not broken anything yet — and why that is not reassuring.** Zintl's transform guard is:

```ts
(id.includes("node_modules") && !isTargetSsrEntry) ||
(id.startsWith("\0") && !isTargetSsrEntry) || …
```

On Rspack the second clause is **false** for virtual modules, so the intended guard does not fire. The first clause is **true** — because the vfs path happens to live under `node_modules/` — so the module is skipped anyway. **The code is right for the wrong reason.** Two independent guards compose into correct behaviour by coincidence, and the coincidence is a path segment in another project's implementation detail.

The same `\0` test appears in core at `index.ts:141`, `:598`, `:1023`, `IOManager.ts:117`, `GraphManager.ts:123`, `CatalogManager.ts:197`/`:265`. `IOManager.getNormalizedId` is the one to watch: it returns `\0` ids untouched, so on Rspack a virtual module would instead be normalized as a real file path and could contribute a boundary id derived from `node_modules/.virtual/%00virtual%3A…`.

**Note on the existing seam.** `BundlerFacet.resolveVirtualPath` is documented as mapping `"virtual:zintl/…"` → `"\0virtual:zintl/…"`, but `viteFacet` implements it as `id => id` and the `\0` is added by the plugin (`hooks/resolve.ts:68`, `:85`). The hook does not do what its doc comment says, and core never routes its `\0` _recognition_ through a facet at all — only its construction, and not even that. Recognition is the half that breaks here.

### L-005 — `emitFile` returns nothing, so there is no asset URL to reference

|                             |                                                 |
| :-------------------------- | :---------------------------------------------- |
| **Status**                  | Open — no fix attempted yet                     |
| **Bucket**                  | **1 or 2** — undecided                          |
| **Facet contract changed?** | Yes — `BundlerFacet` has no asset-emission hook |

**What happened.** Both emission shapes were tried:

```
emitFile({ name: "spike-named.txt", source }) → returned undefined
emitFile({ fileName: "spike-filename.txt", source }) → returned undefined
```

Both files were written (`dist/spike-named.txt`, `dist/spike-filename.txt`), and note that `name` was honoured **verbatim** — no content hash, unlike Rollup, where `name` is a hint and the real filename is hashed.

**The assumption.** _"Emitting an asset gives me a handle I can reference from generated code."_ That is Rollup's contract: `emitFile` returns a `referenceId` which `import.meta.ROLLUP_FILE_URL_<id>` later resolves to the final hashed URL. Zintl depends on it twice, at `hooks/resolve.ts:353-358` and `:374-379`, both in asset localisation.

Rspack's `emitFile` is `compilation.emitAsset(name, source)` — fire and forget, `undefined` returned. **There is no reference id to interpolate**, so the current asset localisation strategy has no counterpart rather than a different spelling.

Not triaged yet, because the two candidate answers differ a lot in cost: a `BundlerFacet.emitAsset` hook returning a URL-or-reference abstraction (bucket 1), versus the compiler owning output naming so a stable path can be emitted without asking the bundler for one (bucket 2). Deferred to Phase 3, where the asset contracts will force the choice with evidence.

### Confirmed available on the Rspack path

Reproduced, and relevant because ZDB §7a Tier 1 depends on all of it:

| Capability                                | Result                                                                                |
| :---------------------------------------- | :------------------------------------------------------------------------------------ |
| `buildStart` / `buildEnd` / `writeBundle` | all fire                                                                              |
| `resolveId` / `load` / `transform`        | all fire; `enforce: "pre"` honoured                                                   |
| Build context members                     | exactly `addWatchFile`, `emitFile`, `getNativeBuildContext`, `getWatchFiles`, `parse` |
| `this.resolve`                            | **`undefined`** — L-002's premise, now reproduced rather than read from source        |
| Virtual modules                           | work end to end                                                                       |

**Phase 2 input, confirmed from shipped types.** `BuildOptions` is `{ watch?: boolean }` and `BuildResult` is `{ close, stats? }` (`@rsbuild/core/dist/types/rsbuild.d.ts:35-49`). **There is no `write: false` and no in-memory bundle**, so `ViteDriver`'s approach — build in memory, read `bundle.output[].code` — has no counterpart. An `RsbuildDriver` must build to a directory and read it back. Programmatic entry points are `createRsbuild()` and `loadConfig()`.

---

## Phase 2 — the contract suite, pointed at a second host

`tests/fixtures/rsbuild-spa` is now a registered manifest driven by an `RsbuildDriver`, and **all four project contracts pass against it**: `build`, `graph`, `transform-dev`, `transform-prod`. Total suite 108/108, the 104 Vite cases unchanged.

Three leaks surfaced getting there. All three were found by the harness failing, none by inspection.

### L-006 — An unfiltered `load` hook retypes every module on Rspack

|                             |                                                            |
| :-------------------------- | :--------------------------------------------------------- |
| **Status**                  | Fixed                                                      |
| **Bucket**                  | **1 — declare it** (the plugin must state what it handles) |
| **Facet contract changed?** | No                                                         |

**What failed.** The build died parsing the HTML template as JavaScript:

```
× Module parse failed: JavaScript parse error: Expected ';', '}' or <eof>
  ╭─[1:10]
1 │ <!doctype html>
```

**The assumption.** _"A `load` hook that returns `undefined` costs nothing."_ True on Rollup and Vite, where an unclaimed id simply falls through to the next plugin.

**Not true on Rspack.** Unplugin implements `load` as a module rule carrying **`type: "javascript/auto"`**, whose `include()` is the plugin's `loadInclude`. With no filter declared, the rule matches every module in the graph and **retypes all of them as JavaScript** — so the HTML template reached the JS parser. Merely _claiming_ a module is destructive there.

**The fix.** A `loadIncludeHook` naming exactly the ids `loadHook` can answer for. This is information the hook already had — its first ten lines are prefix tests — just never declared where the host could read it.

**The sharp edge, worth carrying forward:** the filter has to be **exact, not generous**. `.html` is claimed only under multiplex, the sole mode where `loadHook` returns HTML. Claiming it unconditionally — the naturally cautious choice — reintroduces the bug for every non-multiplex app. On Rollup an over-broad filter is free; here it is the defect.

### L-007 — `transform` had no idea what kinds of file it handles

|                             |                    |
| :-------------------------- | :----------------- |
| **Status**                  | Fixed              |
| **Bucket**                  | **1 — declare it** |
| **Facet contract changed?** | No                 |

**What failed.** With L-006 fixed, the HTML template still reached `transformHook`, which rewrote it as though it were a source module.

**The assumption.** _"Everything arriving at `transform` is a script module."_ This is **true of Zintl's design** — HTML projection goes through `transformIndexHtml` and `compiler.transformHtml()`, never through `transform` — but it was never _stated_, because on Vite HTML is not a module in the graph and so never arrived. On Rspack the HTML template is processed through a loader chain, and unplugin inserts `transform` into it.

**The fix.** A `transformIncludeHook` excluding `.html`. The belief the code held was correct; the fix is that it is now written down where a host can honour it.

**Why this is not a reversal of L-003.** These look contradictory — L-003 _deleted_ an extension list, L-007 _adds_ an extension test — and they are not, because they answer different questions. L-003's list gated _whether a dependency needs a per-locale copy_: a question about content, which the graph owns. L-007's test asks _whether this hook can parse this file at all_: a question about the file's language, which the plugin owns. Getting the bucket right depends entirely on naming the question, not the mechanism.

### L-008 — The host view has to come from the host

|                             |                                                             |
| :-------------------------- | :---------------------------------------------------------- |
| **Status**                  | Fixed                                                       |
| **Bucket**                  | **2 — relocate**                                            |
| **Facet contract changed?** | Yes — `BundlerHostView` must be host-derived, not defaulted |

**What failed.** `JSON.stringify` threw `RangeError: Invalid string length` inside `MessageManager.saveManifest`. Probing the live compiler showed why:

```
manifest keys: 217
sample keys: ['coverage/index.html', 'examples/react-basic/index.html', …]
```

The compiler had rooted itself at the **monorepo root** and discovered 217 boundaries across the entire repository — every example app, plus `coverage/` — producing a manifest too large to serialize.

**This one is self-inflicted, which is the interesting part.** L-001 introduced `fallbackHostView()` as a safety net, with `root: process.cwd()`. On Vite it is unreachable, so it looked free. On Rspack — the one host it exists for — it is the _only_ path, and `process.cwd()` is wherever the test runner started.

A fallback that is only ever exercised on the path nobody tests is not a safety net; it is an untested default wearing one. The general lesson for the facet contract: a host-supplied value needs a way to be _absent_ that is loud, not a plausible-looking default.

**The blast radius was wider than the error.** The `RangeError` was only the symptom that surfaced. While mis-rooted, the compiler also treated the repository's own `README.md`, `CLAUDE.md` and `docs/**/*.md` as translatable assets, and wrote **2 MB of translated Markdown into `<repo>/src/i18n/`** — a directory this monorepo does not otherwise have. It was untracked, has been removed, and nothing reached the tracked tree.

Worth recording for two reasons. A mis-rooted compiler **writes**, so a wrong root is not a read-only mistake. And the write landed at a path that does not exist in this repo, which is exactly why it was invisible — had it collided with something real it would have been noticed at once. This is the hazard `copiedExampleSource` documents at length for `.zintl` — an artifact outliving the run that produced it — arrived at by a different route.

**The fix.** `nativeHostView(pluginContext)` reads unplugin's `getNativeBuildContext()` and takes `compiler.options.context` as the root on the Rspack/webpack shape, falling back only when the host genuinely offers nothing. This is the first concrete answer to §9 Q4 — _what does a facet get to ask about its host?_ — and the answer so far is "its root, and it must actually ask."

### What worked — and one of these is the whole thesis

**Chunk-aligned catalogs survived the port intact.** The Rsbuild build emitted three async chunks, one per non-source locale, each carrying only its own catalog:

```
dist/static/js/async/0.js →  "b_ae1e7cbb2f74": { "90e40d50": "ابدأ الآن" }
dist/static/js/async/1.js →  "b_ae1e7cbb2f74": { "90e40d50": "Empezar" }
dist/static/js/async/2.js →  "b_ae1e7cbb2f74": { "90e40d50": "开始使用" }
```

No `en` chunk — ghost mode held, the source locale was never written. **Zintl contains no Rspack chunking code**; the compiler emits one virtual module per chunk behind a dynamic import and lets the host's own splitter place them. That the same mechanism produces aligned output on `splitChunks` as on `manualChunks` is the strongest evidence yet that the chunking design is genuinely host-independent — and §5.3 predicted this was where a _quiet_ failure would hide, so it is worth stating that it did not.

**Extraction needed no adaptation.** Five keys, correct stitching across `<code>` tags, correct `{counter}` placeholder normalisation — from an unchanged extractor.

**§9 Q1 — answered: no.**

> _Does the contract capability set need a genuine `bundler:*` dimension?_

**It does not.** Capability matching is a positive-only subset test, so a manifest claiming exactly `build`, `graph` and `transform` selects the four project contracts and is skipped by the other seventeen — no contract edits, no `excludes` mechanism, no new dimension. The existing model expressed "run only the build-time contracts against this host" without extension. Recorded as an answer rather than a non-event, because adding the dimension pre-emptively would have answered the question by assumption.

**`compile()` is shared verbatim.** `RsbuildDriver.compile()` and `ViteDriver.compile()` call one `compileWithZintl()` with no per-host branching. The compiler contract needed no adaptation at all; everything that made portability hard lived in the plugin.

---

## Verification notes for Phase 0

Recorded because §6.6 asks for what could not be verified, and because two of the repo's own gates turned out not to be usable signals on this machine.

**Contract suite — green, but only below 4 workers.** `vp test --config=tests/vitest.config.ts --maxWorkers=2` → **104/104 passed**. At the committed `maxWorkers: 4` (`tests/vitest.config.ts:30`) every run fails exactly one test, and **a different one each time**:

| Tree               | Workers | Result                                       |
| :----------------- | :------ | :------------------------------------------- |
| Phase 0            | 4       | 1 failed — `[HMR Hammer] react-basic`        |
| baseline (stashed) | 4       | 1 failed — `[Localized Assets] assets-basic` |
| baseline (stashed) | 4       | 1 failed — `[Memory Leak] react-basic`       |
| Phase 0            | 2       | **104/104 passed**                           |

Two of the three failures are on the **unmodified** tree, and all three are timeout-shaped. So this is contention on this machine, not a Phase 0 regression — but it is also not nothing. CLAUDE.md's "no retries, every flake was a real defect" says this deserves an investigation of its own, and it did not get one here because it is not what proposal 026 is about. **`INFERRED`: that the 4-worker failures are purely environmental. Reproduced: that they occur equally on the unmodified tree.**

**`vpr bench` — no usable signal on this machine.** L-003 deletes a cheap pre-filter, so it trades one extra `this.resolve` per previously-skipped edge for a graph lookup; the budgets were the intended arbiter. They could not arbitrate:

| Run                | Budgets exceeded | Reference Calibration (No-Op) | Structural HMR |
| :----------------- | :--------------- | :---------------------------- | :------------- |
| Phase 0            | 2                | 0.98x                         | 0.53x          |
| baseline (stashed) | 5                | 0.68x                         | 0.16x          |

The **no-op calibration** regressed on both runs, and `Catalog Serialization Logic` — which neither change touches — regressed 0.75x on one and blew its budget on the other. The machine is the variable. Phase 0 measured _better_ than the tree it is compared against, which is not a claim that it is faster; it is a statement that the instrument could not resolve the difference.

**`INFERRED`: that L-003 carries no meaningful cost on the Vite path.** Not reproduced. It needs a quiet machine, or many samples, before the deletion can be defended on performance grounds rather than on correctness grounds. Correctness is not in doubt — the allow-list was answering the wrong question — but "and it costs nothing" is currently unmeasured.

**`vpr verify` — passed** (lint, knip, 728 unit tests, format). The one initial failure was a pre-existing format issue in `026-rsbuild-as-falsification-harness.md` itself, unrelated to any code change.
