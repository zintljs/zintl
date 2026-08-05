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
