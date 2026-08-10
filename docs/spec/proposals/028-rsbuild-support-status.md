# Proposal 028: Rsbuild Support — Current State and Remaining Gaps

**Status**: STATUS REPORT — not a design proposal. It audits work already landed (PR #11, PR #13) against a live repository checkout and names what is left, so the next person does not have to reconstruct it from two ledgers and a diff.
**Date**: 2026-08-09
**Depends on**: [026-rsbuild-as-falsification-harness.md](026-rsbuild-as-falsification-harness.md), [027-completing-the-rsbuild-target.md](027-completing-the-rsbuild-target.md), [027-leak-ledger.md](027-leak-ledger.md). This document does not restate their evidence — it restates their **conclusions**, checked against the code as it stands today, and adds nothing that was not already true in the ledgers.

## 0. What this is

Two PRs did the work this reports on:

- **PR #11 — "Feat/rsbuild support" (proposal 026).** A falsification spike: borrow Rspack, the most foreign plugin model available, and let it disprove "the compiler is bundler-agnostic." Nineteen leaks found, fifteen fixed. Explicit conclusion: keep it a harness, not a target.
- **PR #13 — "Feat/rsbuild support completion" (proposal 027, phases 0–4a).** Reopened that conclusion and did the work 026 named but declined: dev-mode detection, per-locale `<html dir>`, a host-neutral HTML transform seam, `\0`-recognition through a facet instead of a coincidence, and promotion of the fixture to `examples/rsbuild-spa`.

027's own status header still reads **IN PROGRESS**. That is accurate — one item in its plan (§2.4, the HMR ordering defect) was never picked up, and one leak was found _during_ the work that wasn't there before (L-022). This report's job is to say, precisely, where that leaves the target: what a user gets if they import `zintljs/rsbuild` today, and what they don't.

## 1. What works today

### 1.1 The plugin exists and is published

`zintljs/rsbuild` is a real export (`packages/zintl/package.json`'s `exports` map, `./rsbuild` → `dist/rsbuild.mjs`), built from `packages/zintl/src/rsbuild.ts`, which re-exports unplugin's Rsbuild target: `const rsbuild = unplugin.rsbuild; export default rsbuild;`. It is not gated behind a subpath nobody would find — it is a first-class entry point next to `./vite` and `./macro`.

It carries its own disclaimer in the module doc comment: _"Experimental, and deliberately narrow… It is not a supported target, and the `zintljs` package does not yet promise it will behave."_ That sentence is still true of the code, not just of the comment — see §4.

### 1.2 The bundler-facet layer: `rspackFacet`

`packages/compiler/src/facet/presets/rspack.ts` activates on `when: { bundler: "rspack" }` — and unplugin reports `framework: "rspack"` for both raw Rspack **and** Rsbuild builds, so this one facet covers both without needing an `rsbuildFacet` (verified against `@rsbuild/core@2.1.10`'s plugin adapter, per the facet's own doc comment). It provides:

| Hook                    | What it does                                                                                                                          |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `resolveVirtualPath`    | Identity function — the `\0` prefix is added by the plugin, not the facet.                                                            |
| `isVirtualId`           | Recognises `\0`-prefixed ids **and** unplugin's materialised path form (`node_modules/.virtual/…`). This is the L-004 fix — see §1.4. |
| `dynamicImportTemplate` | A bare `import(...)`, no `/* @vite-ignore */` annotation (that was L-012 in 026, already fixed before this report's window).          |
| `hmrInjectionCode`      | Emits a comment token only — no `import.meta.hot` reference.                                                                          |
| `hmrSelfAcceptCode`     | Returns `""`. Deliberately: no dev-time hot-update acceptance is emitted on this host at all. See §4.1.                               |

The comment on the facet is explicit about what this buys even without HMR: _"the point of this facet is as much what it stops as what it adds"_ — before it existed, core fell back to Vite's `import.meta.hot` on every non-Vite host, and five committed dev-transform snapshots had it baked in.

### 1.3 Dev-mode detection is now correct (L-020, PR #13)

Rsbuild leaves Rspack's `compiler.options.mode` at `"none"` in both `dev` and `build` actions — it drives optimization from its own config layer instead of webpack's mode presets. `L-018`'s dev detection (`mode === "development"`) therefore never fired on Rsbuild, `__ZINTL_DEV__` folded to `false` in every action, and dev-only diagnostics (the settle beacon `__zintl_version`, the delivery ledger `__zintl_ledger`) compiled away — even though the runtime itself was working correctly.

Fixed by asking the layer that actually knows: `packages/zintl/src/plugin.ts` grows an `rsbuild: {}` escape-hatch block (structurally the twin of the existing `vite: {}` block) that reads `RsbuildContext.action` (`'dev' | 'build' | 'preview'`) during Rsbuild's own `setup(api)`, before `buildStart`. `preview` is deliberately treated as **not** dev. `host.ts` merges this as a `hostHints` contribution over the native (Rspack) view rather than overriding it — a host is allowed to be a stack, and `hostHints` only supplies facts the inner layer structurally cannot know.

Verified against the full 118-contract suite with no snapshot churn: build-time contracts compile through `compileWithZintl` directly and never touch `hostHints`.

### 1.4 `\0` recognition goes through the facet, not a coincidence (L-004, PR #13)

Core previously tested `id.startsWith("\0")` — Rollup's convention — at seven sites to decide whether a module was Zintl's own. On Rspack that test was **false** past the `transform` boundary, because unplugin materialises virtual modules as real files under `<context>/node_modules/.virtual/`. Nothing broke, because an adjacent `id.includes("node_modules")` check happened to also be true — correct behavior resting on another project's choice of directory name, not on anything Zintl asserted.

`BundlerFacet.isVirtualId(id)` (landed in `IOManager`, exposed to `GraphManager` and `CatalogManager`) replaces the byte-test at six of the seven sites; the seventh (`isSsrEntryTarget`) is a normalization, not an ownership check, and was left alone on purpose. The default with no facet active is `id.includes("\0")`, so the compiler's own unit-test behavior is unchanged on the no-facet path.

### 1.5 The HTML seam and per-locale direction (L-019, L-021, PR #13)

This was the deepest hole 026 left open, and it's the one this report should describe most carefully because it's genuinely non-trivial.

**The seam.** `packages/zintl/src/hooks/html.ts` wires `api.modifyHTML` (Rsbuild's hook, same shape as Vite's `transformIndexHtml`) to the same host-neutral `compiler.transformHtml()` that already backed the Vite path. It is registered from the plugin's `rsbuild: {}` block, because `api.modifyHTML(fn)` has to be registered during Rsbuild's own plugin setup, and only `packages/zintl` — not a compiler facet — can do that. Two problems had defeated 026's attempt at this same wiring:

1. **Identity.** `ModifyHTMLContext.filename` is an **output** name (`index.html`, relative to `dist`), where Vite hands an absolute **source** path. `hooks/html.ts` inverts this: `filename` → `environment.htmlPaths` → entry name → `html.template` → source id — and bails loudly (a logged warning, page passed through unmodified) at any step that yields nothing, rather than silently no-op'ing.
2. **The boundary link (L-021).** An Rsbuild-generated `index.html` names no `<script>` tag — Rsbuild injects the entry from `source.entry` at build time — so nothing connected the document to a trust anchor, and the direction map (below) came out empty even after the mechanism existed. `declareHtmlEntriesHook`, also in `hooks/html.ts`, reads `source.entry` off the normalized Rsbuild config and populates `ctx.htmlEntries` directly, registered on `onBeforeEnvironmentCompile` (not `onBeforeBuild`, which — measured, not assumed — never fires for `rsbuild dev`).

**Direction's home.** `ContentFacet.rtlLocales`, unioned by `ZintlCompiler.getRtlLocales()`, is substituted into the runtime as `__ZINTL_RTL_LOCALES__` (a hoist of data that HTML catalogs already carried, not an invented table — the runtime holds no hardcoded RTL language list). This mechanism is host-neutral and was already correct by the time L-021 was found; L-021 was that the _input_ to it was empty on Rsbuild, not that the mechanism was wrong.

**Net effect**: on `rsbuild-spa` today, switching locale sets `<html lang="ar" dir="rtl">`, translates `<title>`/`<meta description>`, and scaffolds `index.html.translations.json` the same way every Vite example does. `locale-switch`, `rtl`, and `locale-switch-stress` are claimed on the manifest and pass.

### 1.6 Assets survive intact (L-009 — fixed before this report's window, now covered by a real contract)

Rspack types modules by file **extension**, decided before any plugin runs; Rollup/Vite type by whoever loaded the module. A localized `.txt` asset that Zintl serves as JavaScript was previously classified as a binary asset and base64'd into a `data:` URI — shipping the wrong bytes with a **green build and green contracts**, because nothing before PR #13 asserted the rendered text in a browser. Fixed (pre-dates this PR pair) by giving generated modules an extension-free virtual identity; PR #13's contribution was generalizing the `assets` contract (previously hardcoded to one fixture's heading element, described in `027-leak-ledger.md` Phase 2) into something a second project could actually claim, and claiming it on `rsbuild-spa`.

### 1.7 `rsbuild-spa` is a real `examples/` member, not a fixture

`tests/fixtures/rsbuild-spa/` became `examples/rsbuild-spa/`. Concretely, as of this checkout:

- It builds under `vpr build:examples` and is linted and knip-checked like every other example — the `ignore: ["tests/fixtures/rsbuild-spa/**"]` knip entry is gone, and knip needed **no** replacement entry (it discovers `@rsbuild/core` unaided from `rsbuild.config.mjs`).
- It has its own `package.json` (`dev`/`build`/`preview` scripts, its own `@rsbuild/core` dependency — no longer borrowed from the workspace root), `tsconfig.json` (`types: ["@rsbuild/core/types"]`, mirroring how Vite examples reach for `vite/client`), and a committed `index.html.translations.json` + schema.
- `composition.test.ts`'s golden file now derives the bundler per example from the config file on disk instead of asserting a hardcoded `"vite"` for every entry — before PR #13 this guardrail would have silently described `rsbuild-spa` as resolving `viteFacet`, which is exactly the L-012 defect (Vite syntax into Rspack output) it exists to catch.

### 1.8 Capability count

`rsbuild-spa`'s manifest (`tests/manifests/rsbuild-spa.ts`) currently claims:

```
build, graph, transform, spa, assets, boundary-graph, locale-switch, rtl, locale-switch-stress
```

— 9 of the 15 capabilities the contract layer defines (`packages/testing/src/contracts/types.ts`). Contract case count has grown from 104 (pre-026) → 118 (end of 026) → 122 (end of the PR #13 work, Phase 4a). Every capability on the list was added only after its contract passed against this host — the manifest's own doc comment calls this out as the reason the suite carries no skipped tests, and the ledger corroborates it entry by entry.

## 2. What is explicitly not supported

Comparing against `vanilla-spa-basic` — the Vite example `rsbuild-spa` was designed to mirror — makes the gap concrete:

| Capability                                       |   `vanilla-spa-basic`    | `rsbuild-spa` | Why not                                                    |
| :----------------------------------------------- | :----------------------: | :-----------: | :--------------------------------------------------------- |
| `spa`                                            |            ✅            |      ✅       | —                                                          |
| `build` / `graph` / `transform`                  |            ✅            |      ✅       | —                                                          |
| `boundary-graph`                                 |            ✅            |      ✅       | —                                                          |
| `assets`                                         | n/a (no localized asset) |      ✅       | —                                                          |
| `locale-switch` / `rtl` / `locale-switch-stress` |            ✅            |      ✅       | —                                                          |
| `hmr`                                            |            ✅            |      ❌       | §2.1 below                                                 |
| `hmr-stress`                                     |            ✅            |      ❌       | requires `hmr`                                             |
| `chaos`                                          |            ✅            |      ❌       | requires `hmr`                                             |
| `memory`                                         |            ✅            |      ❌       | requires `hmr`                                             |
| `performance`                                    |            ✅            |      ❌       | §2.5 below — not purely an `hmr` gap                       |
| `ssr`                                            |           n/a            |      ❌       | §2.4 below — SPA-only claim, but SSR is unbuilt regardless |

### 2.1 Dev-time hot updates — not implemented, on purpose

`rspackFacet.hmrSelfAcceptCode()` returns `""`. This is a stated gap, not an oversight: ZDB §7a (`docs/spec/ZDB.md`, evidenced in `docs/spec/proposals/024-delivery-bus-and-update-ordering.md`) makes dev support conditional on two load-bearing properties — a monotonic, non-repeating per-event sequence, and a `read()` call scoped to that specific event's content — and neither has been established for Rspack's watch/rebuild cycle. Shipping the `module.hot` equivalent without them would reproduce the exact ordering defect the delivery bus was built to eliminate, just on a second host.

`pnpm dev` under `examples/rsbuild-spa` serves and rebuilds on file changes, but a browser tab must be manually reloaded to see a string edit — the README says this plainly rather than shipping a `dev` script that silently never updates.

**A related, separate item**: 027 §2.4 named an _existing_, Vite-side HMR ordering defect — `hmr-hammer` on `react-basic` loses one hot-update event in roughly 1-in-8 full-suite runs at 4 workers — as a prerequisite to trust before extending HMR to a second host. That diagnosis work (instrument `hooks/hmr.ts`'s `fileToModulesMap` mutation, confirm or rule out the repointing hypothesis) was never done in PR #13. It is orthogonal to Rsbuild specifically — it reproduces on Vite — but it is still open, still unowned, and still gates any future Tier-2 work here per 027's own sequencing (§4: "2.4 HMR diagnosis → hmr capability").

### 2.2 MPA / multiplex — fenced, not fixed (L-022)

**Update, post-028**: this is no longer a build crash. Under multiplex (per-locale HTML fan-out), `loadIncludeHook`'s filter still unconditionally claims `.html` under multiplex —

```ts
if (cleanId.endsWith(".html")) return ctx.getMultiplex();
```

— which is correct on Vite and was **fatal** on Rspack: unplugin's `load` rule retypes the claimed template as `javascript/auto`, and the build died inside `html-rspack-plugin`'s child compilation trying to parse `<!doctype html>` as JS, with an error naming a loader chain rather than Zintl.

That claim is now unreachable on a bundler that cannot survive it. `BundlerFacet` gained `htmlFanOut?: boolean` — `true` on `viteFacet`, deliberately undeclared on `rspackFacet` — and `host.ts::ensureCompiler` checks it against `ctx.getMultiplex()` before constructing the compiler at all:

```ts
if (ctx.getMultiplex({ root: resolved.root }) && !capabilities.flags.htmlFanOut) {
  throw new Error(`[Zintl] Multiplex is not supported on "${resolved.bundler}": ...`);
}
```

This follows the same "ask the facet, don't test the bundler string" pattern L-004 established for `isVirtualId`, rather than an `if (bundler === …)` inline in `resolve.ts`, which would have been the "fork" anti-pattern 026 §8 warns about. Verified against a real `zintljs/rsbuild` build (`tests/fixtures/multiplex-rsbuild-fence.ts`, `tests/contracts/multiplex-fence.contract.spec.ts`): the build now rejects immediately, before any module resolution, with the `[Zintl] Multiplex is not supported...` message instead of the opaque crash. Full detail in `027-leak-ledger.md`'s L-022 entry.

**What remains unchanged**: the real fan-out is still undesigned for Rspack — 026 §7 and 027 §6 both explicitly scope MPA/HTML fan-out out, and that scoping stands. Only the failure mode changed, from a silent-looking crash in someone else's error to a loud, actionable one in Zintl's own voice.

### 2.3 Asset emission with no reference id — still unreproduced (L-005)

Rspack's `emitFile` returns `undefined`, so Zintl's `import.meta.ROLLUP_FILE_URL_<id>` pattern (used twice in asset localization) has nothing to interpolate. This was flagged in 026 and remains **open** in PR #13's window — not because it was deprioritized, but because reproducing it turned out to require the exact path L-022 breaks: a multiplexed fixture with a real (non-`?raw`) asset import. Two things were learned in the attempt, though, worth keeping:

- `?raw` imports never call `emitFile` — they return a string literal — which is why every asset path exercised through both proposals survived on Rspack so far.
- A non-`?raw` text-asset import is unsupported on **both** hosts today (it fails on Vite too, with raw text reaching the JS parser), so this specific defect is not actually an Rspack-only gap; it just can't be told apart from one until L-022 is fixed and a real repro runs.

The design question this leaves open — a `BundlerFacet.emitAsset` URL-or-handle abstraction vs. the compiler owning output naming so no host handle is needed at all — has no evidence yet, by construction: nothing has reached that code path on Rspack.

### 2.4 SSR — untouched

Not attempted, not examined, in either PR. `hooks/html.ts`'s `modifyHtmlHook` explicitly skips non-`"web"` output targets rather than silently doing nothing (a deliberate, logged bail — see §1.5), which is the correct behavior for _not_ handling SSR, but no SSR path exists to route to. Both 026 §7 and 027 §6 name this as future, separate-proposal territory.

### 2.5 `<link rel="modulepreload">` injection — absent

The HTML projection injects an empty `preloads: {}` on Rsbuild (`hooks/html.ts`'s `modifyHtmlHook` doc comment states this is deliberate — computing it would mean re-implementing the Rollup `bundle`-derived mapping against `Rspack.Compilation`'s chunk graph, a second implementation of the same logic). Catalogs still load correctly; they take one extra network round-trip to start fetching compared to Vite.

### 2.6 `performance` — not just an `hmr` gap

Distinct from the four capabilities blocked purely by the `hmr` dependency: `performance-size`'s contract filters network responses by Vite-specific URL shapes (`virtual:zintl`, `/i18n/`, `.json`), which see none of Rspack's hashed async chunks. The manifest's own comment is explicit that this contract's header already documents it as measuring "dev-wrapped modules inside a timing window" and concedes it doesn't measure what its name promises — so the right fix is rewriting that contract against built output for _both_ hosts, not teaching it a second URL pattern as a workaround.

### 2.7 Not documented in user-facing docs

`docs/configuration.md` and `docs/architecture.md` — the two documents a user would actually read — contain **zero** mentions of `rsbuild` or `rspack`. Everything about this target currently lives in: the `zintljs/rsbuild` module's own doc comment, the `examples/rsbuild-spa/README.md`, and the two spec proposals. A user has no way to discover this entry point exists except by reading source or `examples/`. Given the entry point _is_ published and importable, this is a real gap between what the package can do and what it says it can do.

### 2.8 No declared peer dependency

`packages/zintl/package.json`'s `peerDependencies` lists only `vite`. There is no `@rsbuild/core` entry (not even an optional one via `peerDependenciesMeta`), so nothing in the published package signals a compatible/tested Rsbuild version range to a consumer — a mismatch would surface only at runtime. Consistent with "experimental, unsupported," but worth flagging as something a real support decision would need to close.

## 3. Operational notes worth carrying forward

Two false alarms during the PR #13 window turned out to be artifact-lifetime hazards rather than product defects, and both are the kind of thing that will recur if not written down somewhere a future debugger will find it:

- **`examples/rsbuild-spa/node_modules/.zintl`**, a gitignored directory `copiedExampleSource` deliberately preserves as warm state, held stale compiler metadata from manual debugging runs and produced a phantom `b_assets` boundary in a snapshot test. Diagnosed by `git stash` + rerun showing the _baseline_ also failing — the fix was clearing the directory and rebuilding once, the order CI actually uses.
- **`.tmp/runs/w*/rsbuild-spa` worker copies**, memoized per test worker, caused an intermittent `[Locale Switch] rsbuild-spa` failure (`Execution context was destroyed... navigation`) when a worker's copy predated the HTML catalog files — the Rsbuild dev server saw `flush` write a genuinely new file into its watched tree and reloaded the page out from under the running assertion. Wiping `.tmp/runs` made it 3-for-3 green.

The residual, real (not artifact-related) behavior this exposed: **on a fresh project with no HTML catalog yet, the first `rsbuild dev` run causes one page reload**, because nothing tells the Rsbuild watcher that a Zintl-authored write isn't a user edit — Vite's `handleHotUpdate` has an explicit `isWritingFile` guard for this; Rsbuild has no equivalent. Self-correcting after the first write (`safeWriteFile` skips identical content thereafter), but a real first-run UX wrinkle if this ever becomes a supported target.

## 4. Summary

| Question                                                             | Answer                                                                                                                                                                                                                                                         |
| :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does `zintljs/rsbuild` exist and build real apps?                    | Yes — production builds work, chunk-aligned catalogs survive the port with zero Rspack-specific chunking code, ghost mode holds.                                                                                                                               |
| Does the dev server work?                                            | Serves and rebuilds; **no hot updates** — manual reload required, by design, pending ZDB §7a's ordering guarantees.                                                                                                                                            |
| Does the document (`<html lang>`/`dir`/`<title>`) follow the locale? | Yes, as of PR #13 — full parity with Vite examples on this.                                                                                                                                                                                                    |
| Do localized assets work?                                            | Yes, for `.txt`/`.md` passthrough and `?raw` imports. Non-`?raw` binary asset imports are unreproduced and likely broken on **both** hosts.                                                                                                                    |
| Does MPA/multiplex work?                                             | **No, and it no longer crashes.** Fenced: a clear `[Zintl] Multiplex is not supported...` error, thrown before any module resolution. See §2.2.                                                                                                                |
| Does SSR work?                                                       | Unbuilt, unexamined.                                                                                                                                                                                                                                           |
| Is it a supported target?                                            | **No**, explicitly, in both code comments and this document's own reading of the evidence. 9 of 15 capabilities claimed; `hmr` and everything downstream of it absent; multiplex fenced but not implemented; no user-facing docs; no declared peer dependency. |

Nothing here contradicts 026 or 027's own conclusions — this document exists because those conclusions are scattered across two proposals, two ledgers, and a diff, and "what does a user get today" is a question worth being able to answer without reconstructing that trail each time.

## 5. Candidate next steps

Named, not committed to — this is a status report, and picking the next work item is a separate decision. In roughly the order the existing documents' own sequencing implies:

1. ~~**Fix or fence L-022.**~~ **Done.** `BundlerFacet.htmlFanOut` fences the claim; combining `multiplex: true` with a bundler that doesn't declare it now fails fast with a clear `[Zintl] Multiplex is not supported...` error instead of the opaque loader-chain crash. See §2.2 and `027-leak-ledger.md`'s L-022 entry. The real fan-out design for Rspack — and therefore L-005's reproduction, which sits behind it — remains open and separately scoped.
2. **Decide §2.4's fate before touching HMR again.** The Vite-side ordering defect should be instrumented and resolved (or at least understood) before any Tier-2 work is attempted on Rspack — extending a delivery mechanism that is already known to drop an event under load is not where a second host should start.
3. **Write the user-facing doc gap closed**, independent of everything else — a short "Rsbuild (experimental)" section in `docs/configuration.md` costs little and directly fixes §2.7.
4. **Re-ask 027 §11's promotion question once §2.4 and L-022 have answers** — i.e., the "is this a supported target" decision this document deliberately does not make.
