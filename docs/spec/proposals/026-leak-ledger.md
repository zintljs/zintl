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

**L-002b — the walk stopped at extensionless imports.** `FIXED — see below.` The relocated traversal resolved a relative dependency as `getNormalizedId(join(dirname(owner), depId))`. For `./counter` that yields `src/counter`, which matches no key in `metadataGraph`, `internalManifest` or `dependencyGraph` — so the walk terminated and the file was reported translation-neutral. `GraphManager.resolveDependencyFileId` already solves this by trying each known extension, and is used by every other traversal in that file.

Not fixed at the time, deliberately: the move was kept byte-for-byte behaviour-preserving so that "the Vite path is unchanged" was a claim about the diff rather than about a test run.

---

### L-002b (resolved) — and a second inconsistency it was hiding

|                             |                                                 |
| :-------------------------- | :---------------------------------------------- |
| **Status**                  | Fixed                                           |
| **Bucket**                  | **2 — relocate** (use the resolver that exists) |
| **Facet contract changed?** | No                                              |

**The fix.** `hasTranslatableContent` now resolves dependencies through `resolveDependencyFileId`, like every other traversal in `GraphManager`.

The failure direction is what made it worth doing. "Neutral" means _needs no per-locale copy_, so a false positive silently drops a module's translations while a false negative only costs a redundant copy. The walk was failing in the dangerous direction.

**The second defect, found by writing the test.** `resolveDependencyFileId` resolves against `this.lastMetadata` / `this.lastManifest` — the state of the last _built_ boundary graph — while `hasTranslatableContent` is handed its graphs as **arguments**. Resolution and traversal were therefore consulting different data about which files exist, and could disagree. It also only checked manifest keys for an exact hit, where manifest keys are `<file>:<boundary>`, so a file whose only evidence is extracted messages (`src/about.ts:body`) was unresolvable.

Both are now closed: the graphs are overridable parameters defaulting to the built state, and manifest lookup matches the `<file>:` prefix. Neither was reachable from the original call site, which is exactly why a test found them and the code review that wrote the call site did not.

**Honest scope of the impact: no observable output changed.** Not one snapshot, not one example catalog. That is not the fix being pointless — it is the conditions being narrow. `isTranslationNeutral` is consulted only on the multiplex propagation path, and the predicate short-circuits to `true` as soon as the _importer itself_ has content, so a dependency's resolution only decides the answer when the importer is inert **and** its only translatable content sits behind an extensionless import **and** the project is multiplexed. The examples use both import styles (`from "./App"` alongside `from "./counter.ts"`), so the shape is reachable; that combination just does not occur in them today.

Recorded plainly because the alternative is implying a visible bug was fixed. What was fixed is a predicate that gave the wrong answer for a real input shape, verified by four unit tests where previously there were none.

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

### L-009 — Module _type_ is the host's decision, and Zintl assumed it owned it

|                             |                                                            |
| :-------------------------- | :--------------------------------------------------------- |
| **Status**                  | **Fixed**, including the multiplex paths                   |
| **Bucket**                  | **2 — relocate** (identity), not 1                         |
| **Facet contract changed?** | No — the fix is id spelling, which is the plugin's own job |

**Nothing failed.** The build succeeded, all four contracts passed, and the output was wrong — the failure mode §5.3 warned breakage-driven discovery would miss, caught by reading a snapshot rather than by a red test.

**What was wrong.** With a localizable `.txt` asset, the `ar` catalog held a reference to a module whose body was:

```js
module.exports = "data:text/plain;base64,ZXhwb3J0IGRlZmF1bHQgItmK2KjZgtmK…";
```

decoding to `export default "يبقي Zintl الترجمات بجانب الشيفرة التي تحتاجها.\n";`. Zintl generated **correct JavaScript**; Rspack classified the `.txt` resource as an _asset_, base64-encoded that JavaScript into a `data:` URI, and stored the URI in the catalog. At runtime the page renders a data URI where Arabic belongs.

**The assumption.** _"If my `load` hook returns JavaScript, the module is JavaScript."_ True on Rollup and Vite, where module type follows from **who loaded the module**. On Rspack it is a property of the **resource's extension**, decided by configured rules before any plugin speaks — so an id that still says `.txt` is text no matter what comes back.

**The fix — identity, not an escape hatch.** `resolveId` rewrites the ids `loadHook` converts into an extension-free virtual id, and `loadHook` decodes it at the top so every existing branch runs unchanged. The tempting alternative — the Rspack facet rewriting module rules — is §8's fork wearing a facet's clothes. The defect was never that Rspack types by extension; it was that Zintl handed it a name that lied.

**Two things this cost, both worth keeping.**

_`encodeURIComponent` was the wrong encoder, and the failure was invisible._ Percent-encoding preserves `.`, so the encoded id still ended in `.txt` — and unplugin materialises a virtual module as a **real file whose name is the encoded id**. Rspack read `.txt` off that filename and typed it as an asset again: the identical bug, one layer down, with the fix in place and apparently doing nothing. Diagnosed only by instrumenting `resolveId` and finding it _was_ firing, which killed every hypothesis about the condition. base64url has no dots.

_The rewrite must not fire before the per-locale file is chosen._ Multiplexed builds resolve an asset to a **different file per locale**, in branches further down `resolveId`; rewriting the id first short-circuits that and hands every locale the source text. Four scenarios in `asset_scenarios.test.ts` caught it — a real break, not a stale assertion.

**Multiplex, closed in a second pass.** The first fix stopped at the non-multiplex case and left multiplexed projects on the path-based identity. Closing the rest turned on one decision: encode **the whole id, query and all**, rather than a structured `mode/locale/path` triple. Decoding then reproduces byte-identical input, so the rewrite can be applied at each of the five places resolution can land on such a file — the direct case, both source-locale returns, and both localized-path returns — without any downstream branch knowing it happened. Identity changes; nothing else does.

That property is what made the second pass small. A structured encoding would have needed each call site to reason about which fields it could supply, and the sites disagree: one has a locale in the query, one has stripped it, one has already swapped the file.

**Verified.** No `data:` URI anywhere in the suite's snapshots. Each locale chunk carries its real text — `يبقي Zintl…`, `Zintl mantiene…`, `Zintl 将翻译…` — and the catalog entry is now a module namespace access (`…["default"]`) rather than a string. Vite snapshots byte-identical; only `rsbuild-spa`'s moved.

### L-005 — revised: unreachable within the agreed scope

`emitFile` and `import.meta.ROLLUP_FILE_URL_*` could not be exercised. Both `\0virtual:zintl/asset/` return sites in `resolveIdHook` sit inside multiplex-gated branches — one behind `id.includes("zintl-multiplex=")`, the other inside the multiplex propagation block — and multiplex is the HTML fan-out path §7 explicitly excluded.

So the leak stands as read from source in Phase 1 and remains **unreproduced**. Recording the reason precisely, because "we did not get to it" and "it is behind a path this spike deliberately excluded" are different statements, and only the second one tells the next person where to start.

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

**Contract suite at 4 workers — one real defect found and fixed, one still open.**

Throughout this work the suite failed roughly one test per run at the committed `maxWorkers: 4`, and **a different one each time** — `hmr-hammer`, `assets-basic`, `memory-leak`, `ssr-streaming`, `performance-size`. Phase 0 established it happened on the unmodified tree too, so it was set aside as environmental and the work ran at `maxWorkers=2`. CLAUDE.md's rule — _"every flake traced in this suite turned out to be a real defect"_ — turned out to hold again.

**L-017 — inline fixtures were not worker-scoped.** `copiedExampleSource` and `dirSource` materialize into `.tmp/runs/w<worker>/`, memoize per worker, and make `cleanup()` a deliberate no-op because pooled dev servers outlive the labs that created them. `fixtureSource` did none of that: every worker materialized the same `.tmp/fixtures/<id>`, wiping it on the way in and **deleting it on the way out**.

That is a race with two ways to lose. Worker A wipes the tree while worker B is mid-run against it; and worker A's cleanup deletes the tree worker B's pooled dev server is still serving. Both fixture-backed manifests — `assets-basic` and `ssr-streaming` — were among the observed victims.

Fixed by aligning it with the other two sources: worker-scoped root, wiped once per worker rather than once per lab, and a no-op cleanup. Measured across full runs at `maxWorkers: 4`:

| Tree        | Runs | Failed |
| :---------- | :--- | :----- |
| baseline    | 3    | 2      |
| fixture fix | 8    | 1      |

Small samples, and stated as such — but the two fixture manifests stopped appearing entirely.

**Still open: `hmr-hammer` on `react-basic`, once in eight.** A different defect, and the harness's own failure diagnostics name it rather than leaving it to guesswork:

```
hmr packets: {"update": 4}          ← five writes, four hot-update events
settle beacon: 12 (12 updates applied)
delivery ledger: 12 entries, all applied — no failures
compiler ledger: flush #6..#10 → superseded (joined the in-flight flush; dirt retained for the next)
```

Nothing failed. The runtime applied every update it received, and the DOM still held the intermediate `Hammer 4` while disk held the final text. So the loss is upstream of delivery: **one of the five writes produced no hot-update event at all**.

The compiler's mid-flush handling is not obviously the cause — `runFlush` already guards the ABA case with `adoptedRevisions`, so a boundary re-dirtied during a flush keeps its dirty flag, and the retained dirt has a debounce timer behind it. The missing packet points instead at the watcher coalescing two rapid writes into one event whose `read()` had already captured pre-final content. ZDB §7a names exactly that property — _`read()` returning the content of **that** event_ — as one of the two load-bearing requirements for hot updates, and this is what it looks like when it is not quite true under load.

Not fixed here: it is proposal 024 / ZDB territory rather than 026's, and it wants its own change with its own evidence. Recorded with the diagnostics because the expensive part of this bug is reproducing it, and that part is now done.

**`vpr bench` — initially unusable, later measured clean.** L-003 deletes a cheap pre-filter, trading one extra `this.resolve` per previously-skipped edge for a graph lookup, so the budgets were the intended arbiter. On the first attempt they could not arbitrate:

| Run                | Budgets exceeded | Reference Calibration (No-Op) | Structural HMR |
| :----------------- | :--------------- | :---------------------------- | :------------- |
| Phase 0            | 2                | 0.98x                         | 0.53x          |
| baseline (stashed) | 5                | 0.68x                         | 0.16x          |

The **no-op calibration** regressed on both runs, and `Catalog Serialization Logic` — which neither change touches — regressed 0.75x on one and blew its budget on the other. The machine was the variable, and Phase 0 measured _better_ than the tree it was compared against, which is not a speed claim but a statement that the instrument could not resolve the difference.

**Re-run at the end of the work on a quiet machine: `PERF BUDGET OK`, exit 0, with the no-op calibration at 0.99x–1.00x.** So the earlier `INFERRED` note is retired: the allow-list deletion and the graph-owned neutrality walk carry **no measurable cost** on the Vite path. Recording both readings rather than replacing the first, because the first is the more useful one to remember — a green bench on a busy machine would have been just as meaningless as the red one was.

**`vpr verify` — passed** (lint, knip, 728 unit tests, format). The one initial failure was a pre-existing format issue in `026-rsbuild-as-falsification-harness.md` itself, unrelated to any code change.

---

## Deliverable 2 — the revised facet authoring contract

§7 item 2, assembled from the entries above rather than reasoned from first principles. This is the input to the self-activation inversion (§10), which should not freeze the facet API before absorbing it.

Five changes, in descending order of how much evidence sits behind them.

### 2.1 A facet must be able to declare a module's **type**, not just its content

`BundlerFacet` today has three hooks, all about _text_: `resolveVirtualPath`, `dynamicImportTemplate`, `hmrInjectionCode`. Every one assumes that producing the right characters is sufficient.

L-009 shows it is not. On a host that types modules by extension, generated JavaScript that keeps a `.txt` identity is treated as an asset no matter what it contains. The contract needs a way to say _"this module is JavaScript"_ — or, better, for generated modules to carry identities that cannot be mistyped.

Two shapes, and the second is preferred:

- `BundlerFacet.moduleTypeFor(id)` — a per-host declaration. Honest, but it puts a webpack concept in every facet's vocabulary and Rollup facets would return `undefined` forever.
- **Generated modules get extension-free virtual identities**, so type is never ambiguous on any host. Zintl already has this shape in `virtualAssets` mode; it is opt-in and multiplex-gated. Making it the only path removes the question rather than answering it per host.

### 2.2 Hook **applicability** is part of the contract, not an implementation detail

L-006 and L-007. On Rollup a hook that declines is free; on Rspack, `load` is a module rule that retypes what it claims, so an undeclared filter is destructive. Filters must be first-class and **exact** — over-claiming is not the safe direction, which inverts the usual instinct.

`unplugin` already provides `loadInclude` / `transformInclude`, and Zintl now uses both. The facet contract should carry the same idea: a facet that contributes codegen or content handling declares the ids it applies to, and the plugin composes those declarations rather than each hook re-deriving them internally. Zintl's own hooks had this information — it was in their first ten lines, just not where a host could read it.

### 2.3 Host-supplied values need a loud absence, not a plausible default

L-008. `fallbackHostView()` returned `process.cwd()` — reachable only on the path with no test coverage, where it silently rooted the compiler at the monorepo and wrote 2 MB into a directory that does not exist in this repo.

`BundlerHostView` is the right shape and should be part of the frozen contract. The rule to freeze with it: a field the host must supply has no default. Absence should fail at construction with the host's name in the message, not resolve to something that looks reasonable.

This is also the concrete start of an answer to §9 Q4 — _what does a facet get to ask about its host?_ So far: `root`, `isDev`, `isSsr`, `pluginNames`, `logLevel`. Only `root` has been shown to be load-bearing on a second host.

### 2.4 Recognition and construction of virtual ids must go through the same seam

L-004. `resolveVirtualPath` exists to _construct_ virtual ids, and `viteFacet` implements it as `id => id` while the plugin adds the `\0` — so the hook does not do what its documentation says. Meanwhile core _recognizes_ virtual ids by testing `id.startsWith("\0")` at seven sites, going through no facet at all.

On Rspack this currently survives by coincidence: the `\0` test fails, but an adjacent `id.includes("node_modules")` test passes because unplugin's virtual filesystem happens to live under `node_modules/.virtual/`. **Verified masked, not verified correct.** It breaks the day unplugin relocates that directory.

The contract needs `isVirtualId` alongside `resolveVirtualPath`, and core must ask it. Not fixed here, deliberately: nothing fails today, and fixing what does not fail is the audit pass §2 rejects. It is specified so the inversion can include it.

### 2.5 What the evidence did _not_ support

Worth recording, because a contract revision that only grows is a contract nobody trusts:

- **No `bundler:*` capability dimension** (§9 Q1). The positive-only subset match already scoped a second host to build-time contracts with zero contract edits.
- **No per-host `compile()`**. `RsbuildDriver` and `ViteDriver` share one `compileWithZintl()` verbatim. The compiler contract needed no adaptation on a second host, and nothing observed suggests it will.
- **No chunking hook.** Catalog/chunk alignment held on `splitChunks` with no Rspack-specific code. The design of emitting one virtual module per chunk behind a dynamic import is genuinely host-independent.

---

## The §8 guardrail — resolved facet composition as a golden file

`packages/zintl/src/__tests__/facets/composition.test.ts`, one snapshot per example application (19), plus two assertions.

§8 asks for this by name: _"snapshot the resolved capability set per example app as a golden file, so composition stays inspectable as a flat artifact."_ It matters more now than when the proposal was written, because Deliverable 2 proposes new hooks and this is the artifact that makes adding one visible.

Each golden file records the detected frameworks, the resolved facet list in resolution order with concerns and priorities, every capability flag, the extraction surface, and — separately — which facets _declare_ each single-provider hook versus what the merged system view _resolved_. Declaring facets are listed in order rather than as a single winner: resolution is highest-priority-wins with a hard error on ties, so a second name appearing under `hmrInjectionCode` is precisely the condition §10 wants visible before facets self-activate and registration order stops being a readable list.

The two assertions are deliberately not snapshots. Every example must resolve **exactly one** bundler facet (`vite`), which fails loudly if a second host ever leaks into the default composition; and no example may resolve more than twelve facets, which is the blunt number that moves when "just one more capability" happens repeatedly.

**It found two things immediately, and both are about visibility rather than correctness.**

Writing the serializer, the first draft read `ssrWrapCode` off the facets and reported `(none)` for every SSR example — because a facet declares `wrapCode` and only the _merged view_ calls it `ssrWrapCode`. A plausible-looking "nobody provides this" for a hook that is provided. The file now reports both sides, which is why the mistake is worth keeping in the record: the two vocabularies are easy to confuse from outside, and the contract revision should consider whether they need to differ at all.

And with that corrected, the golden files show that `ssr-wrapping` contributes `wrapCode` but **no `entryTargets`, `wrapExports` or `wrapDefault`** — `assembleFacets` constructs `ssrFacet()` with no options, so generic SSR wrapping locates its targets somewhere other than the facet that appears to own them. Not a defect; the SSR examples pass their contracts. But "where does generic SSR get its entry targets" is now a question a reader can _ask_, which it was not before.

### L-011 — Every Vite project resolves as SSR

|                             |                                                    |
| :-------------------------- | :------------------------------------------------- |
| **Status**                  | **Fixed**                                          |
| **Bucket**                  | **3 — delete the guess**, then replace it properly |
| **Facet contract changed?** | No — but it is the sharpest evidence for §2.3      |

Found by the fidelity contract on its first run, which is the entire argument for having written it.

**What failed.** `vanilla-spa-basic` — a vanilla SPA with no server anything — resolved this in a real build:

```
live:      react-extraction, react-codegen, ssr-wrapping, ssr-runtime, client-spa, …
predicted: react-extraction, react-codegen,                            client-spa, …
```

Four ways: `react-basic`, `vue-basic`, `svelte-basic`, `vanilla-spa-basic`.

**The cause.** `viteHostView` derived SSR as `Boolean(config.build?.ssr) || config.ssr !== undefined`. On current Vite the second clause is **always true** — `ResolvedConfig.ssr` is always a populated object — so every project resolved as SSR. This is §6.3 exactly: _"what looks like a deep Vite coupling may be an obsolete Vite pattern we never migrated."_ The expression predates this work (verified against the parent commit); Phase 0a moved it verbatim.

**Severity was latent, not shipped.** `getRuntimeCode` gates `store-server.js` on `isSsr` again at codegen time, so no server runtime reached a client bundle — verified by grepping the committed `vanilla-spa-basic` build snapshots for `AsyncLocalStorage`, `async_hooks` and `runInRequestScope`, all absent. The output was correct and the **capability flags lied**.

### The fix took two attempts, and the first one is the interesting one

**Deleting the clause outright broke every SSR contract** — all ten cases across `hydration` and `ssr-isolation`, measured, not predicted. In dev `build.ssr` is unset, so `build.ssr` alone reports "not SSR" for an SSR dev server and the SSR facets disappear exactly where request scoping is needed.

So the always-true clause **was** load-bearing, by accident. It was doing a real job — keeping SSR alive in dev — through a condition that had stopped discriminating. Removing a constant is not free when something downstream has come to depend on the constant.

The replacement answers the question per phase, because the config only names SSR in one of them:

```ts
function isViteSsr(config: ResolvedConfig): boolean {
  if (config.command === "serve") {
    return Boolean(config.server?.middlewareMode) || config.appType === "custom";
  }
  return Boolean(config.build?.ssr);
}
```

Dev SSR is recognised by its _shape_ — Vite embedded in the user's own HTTP server. Every SSR example and the streaming fixture set both flags; no SPA or MPA sets either; and `configureServerHook` already treats `appType === "custom"` as meaningful, so this reuses a signal the plugin trusts rather than inventing one. Still a heuristic, and said so at the call site: a project embedding Vite without doing SSR would over-resolve. That is a far smaller wrong set than "every project", and unlike the old clause it can answer **no**.

### The second-order finding: SSR-ness belongs to the build target, not the project

With the fix in, the fidelity contract failed again — this time on the four **SSR** examples, because the _client_ build of an SSR app now correctly resolves **without** SSR facets. Nothing about wrapping a server entry or scoping a request belongs in a browser bundle.

That invalidated an assumption both derivations shared: each asked "is this project SSR?" by sniffing for an `entry-server.*` file. The question is not well formed — an SSR app has **two** compositions, and which one appears depends on which target is building.

Both were corrected, and the guardrail came out better for it:

- The golden files now record **both variants for every project** (`client` and `ssr`), which deleted the `entry-server` sniff entirely — the one place the golden files could disagree with the plugin about what they were describing.
- The fidelity contract now asserts **set membership** rather than equality: every composition the plugin actually produced must be one of the two predicted variants. That is also robust to build caching, which made pinning a single target brittle.

**What it demonstrates about the method.** The golden files could not have found the original defect: they derive their own inputs, so both sides of a self-comparison would have been wrong in the same direction. It took a second derivation that was _allowed to disagree_ — the same shape as L-002a, two plausible derivations of one fact differing silently. And the fix then disagreed with the golden files a second time, which is how the per-target insight surfaced at all.

**Verification.** `vpr verify` green (769 unit tests). Full contract suite 117/117 with nothing skipped. One run showed a single `[HMR Hammer] react-basic` failure; it passes in isolation, the suite passes on re-run, and the Phase 0 baseline established that this machine fails a _different_ contract on each high-load run against the **unmodified** tree — see the verification notes below. `react-basic` losing SSR facets in dev has no plausible HMR mechanism either, since `store-server.js` was already excluded from dev client bundles by the codegen-time gate.

---

## Post-spike: the facet self-activation inversion (§10)

The inversion the whole exercise was sequenced to inform. Landed after the ledger above, using it as the input §10 asks for.

**What changed.** `autoFacets` no longer chooses. It gathers every built-in facet as a _candidate_ and each facet answers for itself through `activateFacets`. The framework switch, `if (ssr && !isNext)` and `if (!isNext)` are gone; the decisions they encoded are now declarations on the facets that own them.

**The three §10 constraints, and what each cost.**

_Activation is not a boolean._ `provides` / `supersedes` / `conflicts` are first-class. The `isNext` guard — whose reason ("Next.js brings its own SSR facets; adding the generic ones would collide on `wrapCode` at the same priority") lived in a comment — is now `supersedes: ["ssr:wrapping"]` on `nextjs-ssr-wrapping` and `supersedes: ["ssr-runtime", "client-spa"]` on `nextjs-runtime`. Supersession targets a _provided capability_ as well as a name, so Next replaces "whatever provides SSR wrapping" rather than hardcoding a facet name.

_There must be an explain path._ Every candidate produces a trace entry, including the negative ones, and the trace is committed to the composition golden files. For `vinext-basic`:

```
✓ nextjs-ssr-wrapping          framework=nextjs ✓
✗ ssr-wrapping                 superseded by nextjs-ssr-wrapping
✗ ssr-runtime                  superseded by nextjs-runtime
✗ client-spa                   superseded by nextjs-runtime
✗ vue-extraction               when.framework=vue ✗ (detected: react, nextjs)
```

This is why activation is a **declarative descriptor** rather than a predicate. A predicate can report that it said no; only data can say `when.framework=vue ✗ (detected: react, nextjs)`. An `activate(ctx)` escape hatch remains for conditions a descriptor cannot express, and facets using it get the vaguer trace entry they have earned.

_Order must not be load-bearing._ Membership is decided by activation, precedence by `priority`. Neither consults registration order, which is the property §10 wanted before self-selection made that order invisible.

**§9 Q4 — answered.** _Does the detection context need to see the bundler?_ **Yes**, and the bundler facets are the proof. `viteFacet` now declares `when: { bundler: "vite" }` instead of being appended unconditionally, so `FacetActivationContext` carries `bundler` and `BundlerHostView` supplies it.

### L-012 — The unconditional Vite facet was emitting Vite syntax into Rspack output

|                             |                              |
| :-------------------------- | :--------------------------- |
| **Status**                  | Fixed by the inversion       |
| **Bucket**                  | **1 — facet it**             |
| **Facet contract changed?** | Yes — this is §9 Q4's answer |

Found by the inversion rather than by the harness, but only visible _because_ the harness exists. With `viteFacet` appended to every project regardless of host, the Rsbuild build was emitting:

```js
return import(/* @vite-ignore */ "virtual:zintl/content/ar/entry:b_src_main_render");
```

A Vite-specific annotation, in Rspack output, ignored by the tool reading it. Harmless in effect and wrong in principle — and precisely the class of thing that has no symptom until a host does care.

It is the cleanest demonstration of what "always appended" costs: the old comment said the facet could not be opted out of because the plugin needs its hooks, which conflated _the plugin needs a bundler facet_ with _the plugin needs the Vite one_. Bundler facets remain unconditional **candidates** — opting out of the built-in set should not silently strip host integration — but being a candidate is no longer the same as being active.

### L-013 — The defensive `ensureCompiler` built a host view on every hook call

|                             |                                               |
| :-------------------------- | :-------------------------------------------- |
| **Status**                  | Fixed                                         |
| **Bucket**                  | **2 — relocate** (the laziness, not the code) |
| **Facet contract changed?** | No                                            |

Self-inflicted, like L-008, and caught the same way — by baselining rather than by reasoning.

**What failed.** `[HMR Hammer] react-basic` failed three full-suite runs in a row, with the DOM stuck on the intermediate `Hammer 4` while disk held the final text. The same tree had been green repeatedly an hour earlier, so the obvious reading was the machine — this repository's contract suite does have a load-sensitive failure mode, documented below.

It was not the machine. **Stashing the inversion and re-running the full suite gave 117/117 green**, three of my runs to one of the baseline's. That asymmetry is the whole reason to keep taking baselines: "it passes in isolation and the machine is busy" is a story that fits both a flake and a real regression, and only the stashed comparison separates them.

**The cause.** `ensureCompiler(ctx, host)` takes a host view and returns early if a compiler already exists. Every universal hook calls it defensively, so the call sites read:

```ts
ensureCompiler(ctx, nativeHostView(this));
```

The argument is evaluated **before** the early return. Since Phase 0a that was `fallbackHostView()` — cheap enough to be invisible. The inversion made it `nativeHostView(this)`, which calls the bundler's `getNativeBuildContext()`, and it ran on every `resolveId`, `load` and `transform` of every module, with the result discarded on all but the first.

Not enough to fail a build. Enough to slow the hot path until a contract that hammers five rapid edits stopped converging — which is a good illustration of why that contract exists, since nothing else in the suite noticed.

**The fix.** `ensureCompiler` accepts a thunk, resolved after the early return:

```ts
ensureCompiler(ctx, () => nativeHostView(this));
```

**The lesson, and it generalises past this bug.** A defensive call on a hot path has to be cheap _including its arguments_, and an argument's cost is invisible at the call site — it reads as one function call either way. Phase 0a introduced the pattern with a cheap argument and no note that cheapness was load-bearing; the inversion then made the argument expensive without touching the call sites. That is the same shape as L-011: something depended on a property nobody had written down.

### L-014 — Zintl relied on the host folding `import.meta.hot` in production

|                             |                          |
| :-------------------------- | :----------------------- |
| **Status**                  | Fixed                    |
| **Bucket**                  | **3 — delete the guess** |
| **Facet contract changed?** | No                       |

Found while adding the Rspack bundler facet, by grepping the production snapshots for something that should never be in one.

**What failed.** `tests/contracts/__snapshots__/rsbuild-spa/dist-output/static/js/index.js.snap` — a **production** bundle — contained:

```js
export default proxy;
if (import.meta.hot) {
  import.meta.hot.accept();
}
```

No Vite production build contained it. Only Rspack's.

**The assumption.** The `?raw` asset proxy in `loadHook` emitted that accept call unconditionally, where the `?zintl-raw` branch two lines above it is guarded by `ctx.compiler.isDev`. The omission was invisible on Vite because **Vite substitutes `import.meta.hot` with `undefined` in production builds**, so the branch folds and nothing ships. Rspack performs no such substitution, so it shipped.

So this is "nothing ships that isn't used" being upheld by the _host_ rather than by us — a principle the project states plainly, satisfied by accident on one bundler and violated on the next. That is the most valuable kind of thing a second host finds: not a crash, but a guarantee we were consuming without knowing we depended on it.

**The fix.** Guard the emission on `isDev`, matching its sibling. No change on Vite — the branch was already being eliminated — and the production bundle on Rspack is now clean. Verified by grep across every `dist-output` snapshot in the suite.

### L-015 — Without a bundler facet, core injects Vite's HMR API into any host

|                             |                                             |
| :-------------------------- | :------------------------------------------ |
| **Status**                  | Fixed for Rspack; the core fallback remains |
| **Bucket**                  | **1 — facet it**                            |
| **Facet contract changed?** | No — it used the contract as intended       |

**What failed.** With no bundler facet active, `ZintlCompiler.transform` falls through to `selfAcceptHmrSnippet(fileId)`, which emits `import.meta.hot`. Five committed Rspack dev-transform snapshots carried it.

`utils/hmr.ts` justifies that fallback as being for "the compiler's own unit tests" — a test-only path that turned out to ship the moment a real host had no facet of its own. Phase 0's ledger flagged it as a bucket-3 candidate on inspection; this is it happening.

**The fix — `rspackFacet()`.** It contributes identity virtual-path resolution, an unannotated dynamic import (no `@vite-ignore`, and deliberately no `webpackIgnore`, since these are ids Zintl's own `resolveId` handles), and an `hmrInjectionCode` that emits **the HMR token and no acceptance call**.

That last one is a declaration of a known gap rather than an omission, and it is the interesting part. Rspack uses `module.hot`, so the inherited Vite snippet is simply wrong — but emitting the `module.hot` equivalent would be worse. ZDB §7a makes dev support conditional on two load-bearing properties, a monotonic non-repeating per-event sequence and a `read()` scoped to that event, and neither has been shown to exist on this host. Shipping hot updates without them ships back the ordering defect the delivery-bus specification exists to remove. **Returning a function at all is what matters here: it takes core off its `import.meta.hot` fallback path. Wrong code is worse than no code.**

### L-016 — Generated modules bypassed the facet seam entirely

|                             |                                |
| :-------------------------- | :----------------------------- |
| **Status**                  | Fixed                          |
| **Bucket**                  | **1 — facet it**               |
| **Facet contract changed?** | Yes — adds `hmrSelfAcceptCode` |

Predicted by Phase 1 as item 6, described by Deliverable 2 §2.2, and confirmed by grepping the Rspack snapshots after L-015: four generated virtual modules — the three per-locale content modules and the manager — still emitted `import.meta.hot`, because two call sites in the compiler hardcoded it and **consulted no facet at all**.

So the seam existed and two callers walked around it. That is the more interesting half of the finding: L-015 was a _missing_ facet, this was a _bypassed_ one, and only the second kind survives adding the facet.

**Why the existing hook could not be reused.** `hmrInjectionCode` decorates a _source_ file and has to reason about whether re-executing an entry is safe — the `entryReexecutionSafe` question that exists because Svelte's `mount()` appends where `innerHTML` replaces. A generated catalog or manager has no such question: it is Zintl's own code and always safe to replace. What it _does_ need, and what the source-file hook cannot express, is an accept **with a callback body** — the manager re-registers its loader on update.

**The fix.** A new `BundlerFacet.hmrSelfAcceptCode(callbackBody?)`. Vite spells it with `import.meta.hot`; Rspack returns `""`, declaring it has no hot-update story yet rather than being handed someone else's. When no bundler facet supplies it, nothing is emitted — which is the right default, and a change from the old behaviour of emitting Vite's API unconditionally.

**Verified:** `import.meta.hot` no longer appears anywhere in Rspack output, dev or production. Vite snapshots are byte-identical — the only files that changed in the whole suite were the four `rsbuild-spa` ones.

### Where the `import.meta.hot` leaks stood, in the end

Three separate defects, found in sequence, each hidden by the one before it:

|       | Leak                                             | Why it was invisible on Vite                                 |
| :---- | :----------------------------------------------- | :----------------------------------------------------------- |
| L-012 | `@vite-ignore` in Rspack output                  | The annotation is inert to anyone but Vite                   |
| L-014 | `import.meta.hot` in a **production** bundle     | Vite folds it to `undefined`; the branch was eliminated      |
| L-015 | Core's fallback emits Vite's HMR API on any host | Justified as a test-only path; no non-Vite host had ever run |
| L-016 | Two generated-module call sites bypass the facet | The seam existed and was simply not used                     |

None of them had a symptom on the supported path. All four were one grep apart once a second host existed.

### On the user-facing surface

`"auto"` was misnamed. It read as "be automatic", but automatic is not optional any more: every facet self-activates, and one with no condition is unconditional with no check performed. What the sentinel actually selects is which _set_ is on the table, so it is now `"builtins"` — and `"auto"` was **removed**, not aliased. Zintl is pre-1.0 with no users to migrate, and a silent second spelling is a migration nobody ever finishes; a type error is the cheaper conversation.

`excludeFacet(name)` fills the gap that made the sentinel all-or-nothing — a project wanting everything except one facet previously had to list every facet by hand and keep that list in sync forever. Superseding is the right tool for _replacing_ a facet; this is for simply not wanting one.

---

## Deliverable 3 — should Rsbuild become a supported target?

**Recommendation: no, not now. Keep it as a harness.** Revisit only when someone asks for it with a real application.

**What works today (ZDB §7a Tier 1).** Build, extraction, boundary and chunk graphs, catalog generation, ghost mode, chunk-aligned per-locale catalogs, ICU baking. Four project contracts pass. This is more than expected going in.

**What is unbuilt, and roughly what it costs.**

| Gap                             | Cost                                                                                                                          |
| :------------------------------ | :---------------------------------------------------------------------------------------------------------------------------- |
| L-009 — asset module typing     | Medium. Needs generated-module identity reworked (§2.1), touching the asset, multiplex and HTML paths together                |
| L-005 — asset emission          | Unknown, unreproduced. Behind multiplex; `emitFile` returns no reference id, so the URL strategy needs replacing, not porting |
| HTML projection / MPA fan-out   | Large. `transformIndexHtml` has no counterpart; HTML comes from a plugin, not the graph                                       |
| SSR                             | Large, untouched                                                                                                              |
| **Tier 2 — dev server and HMR** | **Largest, and gated on a question, not on effort**                                                                           |

Tier 2 is the one to be careful about. ZDB §7a makes dev support conditional on two load-bearing properties — a monotonic non-repeating per-event timestamp, and a `read()` scoped to _that_ event. Neither has been shown to exist on this host. Shipping dev support without them would ship back the ordering defect ZDB exists to remove, so the honest sequence is to answer that question before estimating the work, not after.

**Why not now, in one line:** supporting a target means a CI matrix, a second set of snapshots, and a promise to users, and §2.1's counterweight applies — what kills a project at alpha is spending the window on a tool nobody has installed. The door is open and the cost is now written down; that is what this phase was for.

---

## Timebox status

Roughly half the five-day box, spent as: Phase 0 fixes, harness proof, driver seam and fixture, one loop iteration.

**Not hitting §7's stop conditions.** No leak required a second parallel code path in the compiler, and the buckets have not collapsed into "facet the difference" — the four fixed leaks are bucket 2, 2, 3 and 1/1, and the two open ones are bucket 2. The harness is still teaching.

**Where a resumption should start:** L-009. It is reproduced, it has a committed snapshot as its tripwire, and it is the finding that most shapes §2.1 of the contract revision.
