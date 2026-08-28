# Proposal 036: One Boundary-Id Spelling

**Status**: BUILT — the fix is one line, and everything else here is why that line was hard to find
and what it should change about how the next one is written. §6 records two things this document's
own plan had wrong.
**Date**: 2026-08-28
**Kind**: Defect report and post-mortem. Every claim below was produced by running the code.
**Depends on**: the boundary-id normalizers (`IOManager.getNormalizedId`, `calculateSafeBoundaryId`,
`intent-utils.stripExtensions`) and the intent pipeline (`packages/compiler/src/pipeline/`).
**Found by**: [032](032-export-import-facets.md) §7.2 — a translator-context fixture that rendered
pseudo-localized for a reason that had nothing to do with translator context.

## 1. The defect

CLAUDE.md defines an entry point as **"a file with a _top-level_ `zintl()` call"**. In a `.tsx` or
`.jsx` project that shape did not work. Given a module-scope anchor and any string in another
boundary:

```
[warning] [Zintl] Missing key "Welcome back, {user_firstName}!" in boundary "b_src_greeting_tsx_Greeting"
delivery ledger: 1 entry — runtime/locale active     ← no catalog, ever
```

The page rendered `⟦Ẁéļçöṁé ƀàçķ, Ada!⟧` — pseudo-localization standing in for a catalog that never
arrived. In a production build the same strings render untranslated.

## 2. Root cause: three copies of one rule

Normalizing a boundary id — which extensions to strip — was implemented three times:

| Implementation                                                     | Keeps                    | Strips                      |
| :----------------------------------------------------------------- | :----------------------- | :-------------------------- |
| `IOManager.getNormalizedId` — keys the graph and the ownership map | `.html .tsx .jsx` + SFC  | `.ts .js`                   |
| `calculateSafeBoundaryId` — mints the ids that reach emitted code  | `.tsx .jsx .vue .svelte` | `.ts .js`                   |
| `intent-utils.stripExtensions` — normalizes inside codegen         | `.html` + SFC            | `.ts .js` **`.tsx` `.jsx`** |

The first two agree and say why: _"strip logic extensions (ts/js) for stability across JS/TS moves,
but keep jsx/tsx/vue/svelte"_. The third was an outlier with no stated reason.

Downstream, `resolveKingdom` returned the stripped id as the owner, so `generateManagerUrl`
classified an entry chunk's owner as `boundary:` and `calculateSafeBoundaryId` minted `b_src_main`
for a chunk called `b_src_main_tsx`. The manager was generated for an id naming no chunk. It loaded
with a 200 and registered nothing.

## 3. Why it survived

Two independent accidents, and the feature only breaks where both fail to protect it.

**The regex is anchored at end-of-string.** A function-scoped id — `src/main.tsx:boot` — has no
_trailing_ extension, so `stripExtensions` returned it untouched and it matched the graph by
accident. Only a module-scoped id was actually stripped. Every example wraps `render` in
`bootstrap()`, which puts the anchor in function scope, so every example was in the protected case.

**The keep-lists only disagree about two extensions.** Measured, by running each cell:

| Module holding the string | Module-scope anchor                   | Function-scope anchor |
| :------------------------ | :------------------------------------ | :-------------------- |
| `.tsx` / `.jsx`           | **broken**                            | works                 |
| `.ts` / `.js`             | works — both implementations strip it | works                 |
| `.vue` / SFC / `.html`    | works — every implementation keeps it | works                 |

The `.vue` row is why `examples/rsbuild-vue-mpa`'s module-scope `await zintl(props.lang)` was fine.
One cell out of six, reachable only by a shape no project used.

**And it needs a second boundary.** With every string in the anchor's own file the wrong id is used
consistently on both sides and the page renders correctly — which is why `tests/fixtures/pending-locale.ts`,
written days earlier with a top-level `await zintl(lang)`, passed throughout.

## 4. The fix

```diff
- const keepExts = [".html", ...sfcExts];
+ const keepExts = [".html", ".tsx", ".jsx", ...sfcExts];
```

Twelve of `stripExtensions`'s fifteen call sites are **comparisons** — the function applied to both
operands — and stay correct under any consistent keep-list provided both operands share a spelling.
That was the change's one real assumption, and it is the thing `ready:examples` tests broadly: 30
projects across two hosts, 386 contract tests, **zero snapshot diff**.

## 5. What now guards it

- `packages/zintl/src/__tests__/compiler/anchor_scope.test.ts` — the matrix of §3, asserting in every
  cell that the manager's id names **the chunk the boundary actually lands in**. Not that the id
  equals a particular string: the spelling is an implementation detail, the agreement is not.
- `tests/fixtures/jsx-template.ts` gains a second page whose entry uses a module-scope anchor over
  the same component, and `initial-render` visits _that_ page. The coverage is asymmetric on purpose —
  one page gets the browser assertion and it should be the one that was broken.

Both were confirmed to fail with the keep-list reverted. The fixture reproduces the original symptom
exactly: `expected '⟦Ẁéļçöṁé ƀàçķ, Ada!⟧' to contain 'Welcome back, Ada!'`.

## 6. Two things the plan for this had wrong

**A dependency upcast was budgeted and is not needed.** The plan assumed that with the keep-lists
aligned, the extractor's extension-less dependency ids would stop meeting the graph and would need
resolving through a candidate lookup modelled on `GraphManager.resolveDependencyFileId`. They do not:
`getMeta` already tries the raw id, the stripped id and each extension candidate, so that path
tolerates either spelling. Building the helper anyway would have added an exported entry point with
no failing test behind it — the shape [034](034-content-facets-and-the-assets-preset.md) §2 found
rotting, arrived at from the other direction.

**`custom-facets-demo`'s hand-written manager import is not a workaround for this.**

```ts
import brandMgr from "virtual:zintl/manager/none/boundary:b_brand";
```

It looked like one — a module-scope anchor in the same file, reaching into the `boundary:` namespace
this defect wrongly produced. It is not: `b_brand` is a **declared virtual boundary**
(`multi-brand-theme-facet.ts`, `virtualBoundaries: ["b_brand"]`), `boundary:` is the correct kind for
it, and the import is the demo showing a custom facet's manager being used by hand. Left alone.

## 7. The pattern this is the third of

Three defects in recent work, all the same shape: **one derivation, several copies, and the copies
drifted.**

| Where                                                  | The copies                               | How it failed                                                                                    |
| :----------------------------------------------------- | :--------------------------------------- | :----------------------------------------------------------------------------------------------- |
| [033](033-structural-defaults-and-declared-targets.md) | Default sink targets guessed per-site    | Caught text that was not user-facing, and missed text that was                                   |
| [032](032-export-import-facets.md) §7.2.2              | Placeholder-name derivation, three times | The JSX copy handled only `Identifier`, so bindings were dropped and a page rendered `undefined` |
| This                                                   | Boundary-id normalization, three times   | Codegen named a chunk that did not exist                                                         |

Each was silent. Each was found by something else going wrong nearby. The common structure is worth
naming: **a derivation duplicated is a derivation that will drift, and the drift is invisible because
both copies are locally reasonable.** When the copies are compared to each other the mismatch shows;
when each is only compared to its own callers, it does not.

`stripExtensions` now carries a docblock saying which two implementations it must agree with, and
that a fourth copy is never the answer.

## 8. What this does not cover

- Whether `resolveKingdom` should return graph-spelled ids on _all four_ of its return paths. It is
  internally inconsistent — the `resolveOwner` path returns graph-spelled ids and the others return
  stripped ones — and with the keep-lists aligned that inconsistency is now invisible. It is a latent
  trap rather than a live defect, and merging the two namespaces is a larger change than this one.
- The linear scan over `boundaryGraph.nodes.keys()` in `resolveOwner`'s fallback, which ran only for
  the broken shape and is now unreachable in the common case. Unreachable is not removed.
