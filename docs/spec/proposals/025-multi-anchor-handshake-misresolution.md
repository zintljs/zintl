# Proposal 025: Multi-Anchor Handshake Misresolution

**Status**: OPEN — investigation complete, fix not designed or attempted.
**Date**: 2026-08-04
**Depends on**: familiarity with [ZRS.md](../ZRS.md) §3 (Symbiosis Patterns) and §4 (Handshake Axioms), especially Axiom 4 (Discovery Dominance) and Axiom 5 (Specificity Over Heredity).

## 0. How to read this

This document exists because the bug it describes is genuinely confusing to trace by reading the code alone — I spent a full investigation session on it and my first hypothesis turned out to be wrong, disproven only by a control test. Everything below is either backed by a reproduction I ran, or is explicitly marked as unverified. Section 6 records the false start so you don't have to re-walk it.

If you're picking this up: read §1–§4 first (what's broken and why), then §5 (a ready-to-run repro), then decide on a fix direction yourself rather than trusting my §7 sketch uncritically — I did not attempt the fix, only the diagnosis.

## 1. Summary

When a single file contains **more than one independent trust anchor** (no top-level `zintl()`, so each function containing its own `zintl()` call becomes its own Kingdom — ZRS Axiom 5), the compiler's ownership-resolution logic in `packages/compiler/src/pipeline/intent-utils.ts` can attribute one Kingdom's translation loader to a _different_ Kingdom's injected `loadI18nInstance(...)` call. Concretely: `Page`'s injected manager call ends up registering `Header`'s loader instead of its own, and `Page`'s own loader is dropped entirely.

This is not a rare edge case in the abstract — ZRS §3.3 and Axiom 5 explicitly document "each function containing $A becomes its own independent Kingdom" as a supported pattern (the doc's own framing is micro-frontend / multiple independent mount points in one file) — but it appears to have **zero test coverage** anywhere in the suite, which is presumably why it's shipped broken.

## 2. Where this was found

This surfaced while reducing `any` usage in `@zintljs/compiler` for the first-beta prep pass (see the `chore: minify compiler dead code and reduce any usage for beta prep` commit). Retyping `pipeline/intent-utils.ts:527` (`getReachableHandshake`'s `allDeps: any[]`) exposed that `fileMeta.internalDependencies[id]` — a `string[]` per `BoundaryMetadata.internalDependencies: Record<string, string[]>` (`types/graph.ts`) — was being pushed directly into an array otherwise holding `{id, dynamic, bindings}`-shaped `ObservedDependency` objects, with no wrapping. That looked like a plausible, self-contained bug on its own. It turned out to be real, but **not the cause of the misresolution described here** — see §6.

## 3. The actual root cause

### 3.1 The call chain

`intent-core.ts`'s `planAnchors()` (line ~88) calls, once per anchor in the file:

```ts
const { handshake, colonies } = getReachableHandshake(anchor.boundaryId, worldState);
```

`getReachableHandshake` (`intent-utils.ts:480`) does a graph walk starting at the anchor's own boundary id, but it also has this, unconditionally, near the end (`intent-utils.ts:632-637` in the current source):

```ts
// If we are starting from a function-scoped Kingdom, also walk the parent file's dependencies
// to pick up sibling Colonies that might be imported at the module level.
if (startId.includes(":")) {
  const parentFileId = startId.split(":")[0];
  walk(parentFileId);
}
```

For **every** anchor in a file (since every nested-boundary anchor id contains `:`), this walks the bare file id — `"src/multi.tsx"`, not `"src/multi.tsx:Header"` or `"src/multi.tsx:Page"`. `walk()` calls `resolveKingdom(id, worldState)` on it.

### 3.2 `resolveKingdom("src/multi.tsx", world)` does not resolve to "no owner" — it resolves to _a_ owner, non-deterministically

`resolveKingdom` (`intent-utils.ts:117-180`) has four fallback tiers. For a bare file id containing multiple anchors, none of the early tiers match (the file id itself isn't any single anchor's boundary id), so it reaches tier 2: `findEffectiveAnchor(boundaryId, worldState, ...)`.

`findEffectiveAnchor` (`intent-utils.ts:185-324`) has, in order:

1. A local search over the (here, empty) `observation.anchors` passed in — skipped.
2. A loop over **every** file's metadata (`intent-utils.ts:229-268`) doing `candidates.find(...)` against a battery of loose OR'd equality checks (`siteOwnerId === ownerId || siteHash === targetHash || ...`). This is an unordered `Array.prototype.find` over `anchorSites`, which for our file is `[Header's anchor, Page's anchor]` **in source declaration order**.
3. A fallback (`intent-utils.ts:270-287`) that, if the resolved owner is itself an "entry" file, just takes `ownerMeta.anchorSites[0]` — again, first-in-array.
4. A last fallback (`intent-utils.ts:289-321`) that walks `dependencyGraph` entries and **recurses into `findEffectiveAnchor` on the parent file id**, landing back in the same unordered logic.

None of these four tiers have any way to know _which_ of the file's several anchors is the right one for the query that started the walk. They pick whichever anchor comes first when iterating `metadataGraph`'s `anchorSites` array — which is declaration order in the source file, **not** the boundary id being resolved. Confirmed by direct instrumentation (see §5.3): calling `resolveKingdom` on the bare file id returned `"src/multi.tsx:Header"` (the first-declared anchor) for both the Header-anchor's own walk _and_ the Page-anchor's walk.

### 3.3 Why this breaks the loaders map

Back in `intent-core.ts`'s `planAnchors` loop (`intent-core.ts:101-134`), for each `bId` in the handshake set:

```ts
const ownerId = resolveKingdom(bId, worldState);
let kingdomHasActiveTranslations = false;
for (const [fId, meta] of Object.entries(worldState.metadataGraph)) {
  if (resolveKingdom(fId, worldState) === ownerId) {
    if (meta.needsLoader) { kingdomHasActiveTranslations = true; break; }
    ...
  }
}
if (!kingdomHasActiveTranslations) continue;
...
loadersMap.set(bId, { stableId, safeId, boundaryId: safeBId });
```

For `bId = "src/multi.tsx:Page"`, `ownerId` correctly self-resolves to `"src/multi.tsx:Page"` (the early-exit tier in `resolveKingdom` works fine for a boundary id that names itself). But the inner loop calls `resolveKingdom(fId, worldState)` for `fId = "src/multi.tsx"` (the bare file id, since that's a real key in `metadataGraph`) — and per §3.2, that **always** resolves to `"src/multi.tsx:Header"`, never to `"src/multi.tsx:Page"`. So the comparison against Page's own `ownerId` never matches, `kingdomHasActiveTranslations` stays `false` for the entries that should have made it `true`, and **Page's own `bId` is skipped — it never gets its own loader registered.**

Separately, Header's iteration (`ownerId = "src/multi.tsx:Header"`) _does_ match on the same `fId = "src/multi.tsx"` comparison, correctly, and registers itself. What was not fully traced: exactly how `"src/multi.tsx:Header"` (rather than nothing) ends up in `allHandshake` for _Page's_ `getReachableHandshake` call in the first place, given Page and Header have no dependency edge between them in the control repro (§5.2). The `walk(parentFileId)` call in §3.1 is the most likely mechanism — walking the bare file id and finding `isLiveOwner("src/multi.tsx:Header", ...)` true would add Header's kingdom into `reachable`/`handshake` regardless of which anchor's `getReachableHandshake` call is running, since `resolveKingdom("src/multi.tsx", ...)` from §3.2 always lands on Header. This part is a reasonable inference from the evidence, not independently instrumented — worth confirming before fixing.

### 3.4 Connection to ZRS Axiom 4

[ZRS.md](../ZRS.md) §4, **Axiom 4: Discovery Dominance**, states:

> Wherever ownership is decided by which candidate is reached first, the candidates are ordered lexicographically — never by discovery order. ... Any first-wins resolution that is not explicitly ordered is an instance of this bug waiting to be found.

That axiom was written after a near-identical bug in chunk-root ownership assignment (`GraphManager.getChunkRoots`, now sorted via `compareStrings` — see the comment at `managers/GraphManager.ts` around the `getChunkRoots` sort). The `.find()` calls in `findEffectiveAnchor` (§3.2, points 2 and 3) are the same failure shape, unfixed: iteration-order-dependent, not lexicographically ordered, not scoped to the actual query.

## 4. A second, compounding inconsistency (noticed, not fully diagnosed)

`intent-utils.ts` has its own local `stripExtensions()` (`intent-utils.ts:10-30`), separate from `IOManager.getNormalizedId()` (`managers/IOManager.ts:115`), which is the canonical normalization the boundary/chunk graph is actually keyed with. They are not obviously kept in sync. During instrumentation I observed `resolveOwner()` (`intent-utils.ts:48-110`) computing its own `normId` via the local `stripExtensions`, then looking it up in `chunkGraph.boundaryToOwner` — a map built by `GraphManager` using `io.getNormalizedId()`. Whether these two normalizations ever disagree in a way that causes a _lookup miss_ (as opposed to the ownership-resolution bug in §3, which is a different failure mode) was not confirmed with a targeted repro. Flagging it because it's exactly the kind of thing that would explain a _second_, differently-shaped bug in the same area, and because whoever fixes §3 will be reading this code closely enough to settle it.

## 5. Reproduction

### 5.1 Setup

The repro needs a _real_ resolved compiler world (real facets, real chunk/boundary graphs) — a hand-built `WorldState` fixture risks masking or fabricating the bug through construction error. Use `packages/zintl`'s test harness, which builds a real `ZintlCompiler` with resolved facets:

```ts
import { describe, it, expect } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js"; // packages/zintl/src/__tests__/helpers/compiler.ts
import { createTestDir } from "../helpers/fs.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

it("repro: multi-anchor handshake misresolution", async () => {
  const root = await createTestDir("repro-handshake-");
  await mkdir(join(root, "src"), { recursive: true });

  // No top-level anchor: Header and Page are each their own Kingdom (ZRS Axiom 5).
  const code = `import { zintl } from "zintljs";

function Header() {
  zintl("en");
  return <div>Header needs translation</div>;
}

function Page() {
  zintl("en");
  return <div>Page root needs translation too</div>;
}

Page();
`;
  const fullId = join(root, "src/multi.tsx");
  await writeFile(fullId, code);

  const compiler: ZintlCompiler = createTestCompiler(
    { sourceLocale: "en", locales: ["en", "ar"], outputDir: "locales" },
    root,
    true,
  );
  await compiler.setup();

  const res = await compiler.transform(code, fullId, "virtual:zintl/catalogs");
  console.log(res?.code);
});
```

Run with:

```bash
vp test packages/zintl/src/__tests__/compiler/<file>.test.ts --reporter=verbose
```

(`--reporter=verbose` is required — the default reporter swallows `console.log`/`console.error` on a passing test.)

### 5.2 Observed output (actual, captured 2026-08-04)

```js
import { _t, loadI18nInstance } from "virtual:zintl/runtime/internal";
import _zintl_mgr_b_src_multi_tsx_Page from "virtual:zintl/manager/en/entry:b_src_multi_tsx_Page";
import _zintl_mgr_b_src_multi_tsx_Header from "virtual:zintl/manager/en/entry:b_src_multi_tsx_Header";

function Header() {
  globalThis.__zintl_inst = loadI18nInstance({
    locale: "en",
    loaders: { ["b_src_multi_tsx_Header"]: _zintl_mgr_b_src_multi_tsx_Header.loader },
  });
  return (
    <div>
      {_t("Header needs translation", {
        _mgr: _zintl_mgr_b_src_multi_tsx_Header,
        _bId: "b_src_multi_tsx_Header",
      })}
    </div>
  );
}

function Page() {
  globalThis.__zintl_inst = loadI18nInstance({
    locale: "en",
    loaders: { ["b_src_multi_tsx_Header"]: _zintl_mgr_b_src_multi_tsx_Header.loader },
  });
  return (
    <div>
      {_t("Page root needs translation too", {
        _mgr: _zintl_mgr_b_src_multi_tsx_Page,
        _bId: "b_src_multi_tsx_Page",
      })}
    </div>
  );
}

Page();
```

`Page()`'s `loadI18nInstance` call registers `"b_src_multi_tsx_Header"`, not `"b_src_multi_tsx_Page"`. **Note this reproduces with `Page` never calling `Header()` at all** — no cross-boundary reference of any kind between them. This is the control that disproved my original hypothesis; see §6.

The `_t()` sink-wrapping itself is correct in both functions (`Header` uses its own manager, `Page` uses its own) — only the `loaders` map inside `loadI18nInstance` is wrong. That map is what `planAnchors` builds via `getReachableHandshake` + the loop in §3.3.

### 5.3 Instrumentation used to trace it (for reference, not left in the tree)

Temporary `console.error` calls were added at:

- The top of `getReachableHandshake` and inside its `walk()`, printing `id`, `owner = resolveKingdom(id, worldState)`, and `isLiveOwner(owner, worldState)`.
- Inside `findEffectiveAnchor`'s main loop (`intent-utils.ts:229-249`), printing each candidate's match variables and the final resolved `site.boundaryId`.
- Inside `resolveKingdom`, gated on `boundaryId === "zintljs"`, printing which of the four tiers fired and their intermediate values.

None of this is committed — it was reverted (`git checkout -- packages/compiler/src/pipeline/intent-utils.ts`) after the investigation. Re-add similar prints if you need to re-verify rather than trusting this document blindly; the call graph here is easy to mis-trace by eye (I did, twice — see §6).

## 6. False start — read this before re-deriving the same wrong theory

My first hypothesis, going in, was that the bug lived entirely in `getReachableHandshake`'s handling of `internalDependencies` (`intent-utils.ts:527-538`):

```ts
const allDeps: any[] = [...(worldState.dependencyGraph[fileId] || [])];
if (fileMeta?.internalDependencies) {
  if (id.includes(":")) {
    allDeps.push(...((fileMeta.internalDependencies[id] || []) as any[]));
  } else {
    for (const deps of Object.values(fileMeta.internalDependencies)) {
      allDeps.push(...(deps as any[]));
    }
  }
}
for (const dep of allDeps) {
  let depFileId = dep.id;   // undefined for a plain string pushed from internalDependencies
  if (!depFileId) continue; // silently skipped
  ...
```

`internalDependencies[key]` is `string[]` (`types/graph.ts`'s `BoundaryMetadata`), but the objects pushed from `dependencyGraph[fileId]` are `{id, dynamic, bindings}`. Mixing plain strings into an array read via `.id` means every `internalDependencies`-sourced entry is silently dropped. This **is real** — confirmed by direct type-checking (this is what surfaced it) and by reading `GraphManager.ts`'s own handling of the identical data, which correctly does `internalDeps.map((id) => ({ id, dynamic: false }))` before use (`managers/GraphManager.ts`, `resolvedInternalDeps`) — i.e. there is already an established, correct pattern for this exact conversion elsewhere in the codebase that `intent-utils.ts` doesn't use.

I built a repro with `Page` calling `Header()` as a plain function call (to populate a real `internalDependencies` edge via the extractor's `addInternalDependency`, triggered by `visitors/program.ts:484-485`'s `CallExpression` handler) and got the wrong output in §5.2. **Then I built a control — the exact same fixture, minus the `Header()` call — and got byte-for-byte the same wrong output.** That falsifies "the `internalDependencies` bug causes this" as a _sufficient_ explanation: the misattribution happens with zero internal-dependency edges between the two boundaries.

The `internalDependencies`/`.id` bug is still real and still worth fixing (its own consequence, independent of this one, is presumably that internally-nested dependency edges are never traversed for handshake/reachability purposes — I did not build a repro isolating _that_ consequence specifically, since by the time I'd ruled it out as the cause of §5.2 I moved on to tracing the actual cause in §3). Fix both; don't assume fixing one obsoletes checking the other.

## 7. Suggested approach (not attempted — sketch only)

1. **Write unit tests for `resolveKingdom` and `findEffectiveAnchor` first**, covering a multi-anchor-single-file `WorldState` (built through a real compiler, per §5.1, not hand-constructed — hand-construction is exactly what let this bug hide for however long it's been here). Lock in whatever the _intended_ behavior is before changing anything — there's a real risk of "fixing" this into a different wrong behavior without a spec-level test pinning the correct one down first.
2. Apply lexicographic ordering (ZRS Axiom 4) to the two unordered picks in `findEffectiveAnchor` (§3.2 points 2 and 3) — likely means each candidate needs to be scored/filtered against the _actual_ query id rather than matched loosely and taken first. This probably requires narrowing the loose OR-condition match (`siteOwnerId === ownerId || siteHash === targetHash || ...`) to something that can't multi-match in the first place, rather than only fixing the tie-break.
3. Fix `intent-utils.ts:527-538` to wrap `internalDependencies` string entries the same way `GraphManager.ts` already does (`{ id, dynamic: false }`), and add a targeted repro for _that_ consequence specifically (a boundary reachable only via `internalDependencies`, e.g. two Kingdoms connected by a local function call, per the ZRS Colony "no Surprise Colony" handshake requirement in §3.2 of ZRS.md).
4. Resolve whether §4's normalization inconsistency (`stripExtensions` vs `getNormalizedId`) is a real second bug or coincidentally harmless here.
5. Re-run the §5.1 repro; `Page`'s `loaders` map should contain its own boundary id, not Header's.

## 8. Impact assessment (unverified, worth checking before prioritizing)

- Only affects files with **more than one independent trust anchor and no top-level anchor** — ZRS §3.3/Axiom 5's explicit multi-Kingdom-per-file pattern (documented as intentional, e.g. micro-frontend mount points). Most application files have zero or one anchor and are unaffected.
- No existing contract test (`tests/contracts/*.ts`) or example app (`examples/*`) appears to exercise this shape — grepped for "internalDependencies"/"nested"/"colony"/"kingdom" across both, nothing found. That's _why_ this shipped broken, not evidence it's low-impact — nobody has tested the pattern the spec documents as supported.
- Consequence in production: for an affected file, at least one of its Kingdoms gets the wrong (or a missing) loader registration in its injected `loadI18nInstance` call. Whether this actually breaks that Kingdom's own translations at runtime (it self-hydrates via its own `zintl()` call regardless of what its sibling's manager thinks it needs) or only affects some secondary discovery/prefetch path was not traced end-to-end — the compiler-side output is wrong in a way that's easy to demonstrate (§5.2), but the full runtime consequence for a real app needs its own investigation.
