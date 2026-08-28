# Proposal 031: Pending Locales

**Status**: BUILT — implemented 2026-08-27. §5's reasons for deferring were good and are kept
verbatim; they expired rather than turned out wrong. **§10 records what building it changed about
this document**: §4's table was stale by half and pointed at the wrong files, the option shape and
the classification rule are settled (§7), and two of the first tests written for it asserted nothing
at all — both found by running them against the bug, not by reading them.
**Date**: 2026-08-24, built 2026-08-27
**Kind**: Design proposal, with a rejected framing kept on purpose (§1), and an implementation
record (§10).
**Depends on**: the no-fallback rule ([backlog 008](../backlog/008-enforce-no-mixed-locales.md)),
`verifyIntegrity` (`packages/compiler/src/index.ts`), and the per-locale status line
(`getTranslationStatus()`).
**Supersedes**: `docs/spec/backlog/015-pending-locales.md`, which was the wrong folder for a document
whose main content is an argument rather than a completed change.

## 0. Read §1 first

The feature was proposed to solve a problem it does not solve. That mistake is the most useful thing
in this document, because it is the obvious mistake and the next person to reach for pending locales
will reach for them for the same wrong reason.

## 1. The problem this does **not** solve

> A team adds a string on Friday. `verifyIntegrity` fails because `ar` and `fr` are missing it.
> Translators are back Monday. The release is blocked.

Pending locales look like the answer and are not. Trace it: the locales missing the new string are
`ar` and `fr` — **already shipped, with real users**. Marking `ar` pending would drop Arabic from the
release entirely. For a live locale that is far worse than a red build, so nobody would ever use the
feature this way.

The Friday problem and the pending-locale problem share a symptom (`verifyIntegrity` fails) and have
nothing else in common.

### 1.1 The Friday problem has no principled solution, and that is the answer

Every design that lets a build pass with holes ships blank text to users. That is precisely what
backlog 008 removed and what the project exists to prevent. There is no third option: a translation
is present or the UI is empty.

So the escape hatch is one explicit, temporary decision — `verifyIntegrity: false` for a release
taken knowingly — and it is now documented as such in `docs/configuration.md` rather than left as
folklore. Zintl will not make that choice quiet, and it will not make it for anyone either.

What genuinely reduces the cost is **finding out earlier**, which is why the per-locale status line
shipped in its place:

```
[Zintl/WARN] Translations ar 44/47 · fr 12/47 — 38 missing, a production build will fail until they are filled
```

Warned rather than informed, because an incomplete locale is not a status update — it is a build that
is going to fail. The number a team has been watching all week is the same number the gate is about to
check.

## 2. The problem this **does** solve

Standing up a **new** locale over weeks, without breaking every build in between.

A team adds `de` to `locales`. From that moment every build fails, because German is 0% translated and
will be for a month. Today there are two options and both are bad:

| Option                     | Cost                                                             |
| :------------------------- | :--------------------------------------------------------------- |
| Keep `de` out of `locales` | Nothing extracts it; translators have no files to work from      |
| `verifyIntegrity: false`   | The gate is off for **every** locale, including the shipped ones |

The second is the one teams will actually pick, and it silently removes the protection from `ar` and
`fr` for the duration. A per-locale concept is what closes that.

## 3. Design

```ts
zintl({
  locales: ["en", "ar", "fr"],
  pendingLocales: ["de"],
});
```

A pending locale is **maintained but not shipped**:

| Behaviour                  | Pending locale                                                         |
| :------------------------- | :--------------------------------------------------------------------- |
| Extraction                 | Yes — it needs keys                                                    |
| Catalogs written           | Yes — translators need files to fill                                   |
| Reconciliation, pruning    | Yes — it stays in sync as the source changes                           |
| Status line                | Yes, marked pending — progress is the whole point                      |
| `verifyIntegrity`          | **Exempt** — incompleteness is the expected state                      |
| Catalog chunk emitted      | **No**                                                                 |
| In the runtime locale list | **No** — a switcher built from it will not offer German                |
| `zintl("de")` literal      | **Build error**, naming it as pending rather than as an unknown locale |

The no-fallback rule is untouched: a locale ships complete or it does not ship. Nothing renders blank,
because nothing renders in German at all until it is promoted.

**Promotion is moving the string from `pendingLocales` to `locales`.** The build then gates it, and
the first thing it does is report exactly what is still missing — which by then should be nothing,
because the status line has been counting all along.

## 4. Why this is not additive

`locales` currently answers two questions at once:

1. Which locales do we **maintain catalogs for**?
2. Which locales do we **ship**?

They are the same list only because nothing has ever needed them apart. Separating them is a judgment
call at every read site, not a new branch in one place:

> **Corrected 2026-08-27.** The table below was measured on 2026-08-24 and was wrong by the time the
> work started — see §10.1 for what it actually was, and for the read site this whole section missed.

| File                                               | `this.locales` reads |
| :------------------------------------------------- | :------------------- |
| `packages/compiler/src/index.ts`                   | 18                   |
| `packages/compiler/src/managers/CatalogManager.ts` | 28                   |
| `packages/compiler/src/managers/GraphManager.ts`   | 3                    |

Forty-nine classifications, and the failure mode of getting one wrong is quiet in both directions: a
locale that ships when it should not, or one that silently stops shipping. Neither throws.

What this section does not say, and should have, is **which of the two meanings keeps the name**.
That turns out to be the whole of the risk management — see §10.2.

## 5. Why it was deferred

Kept verbatim. All three reasons were about _timing_, and none of them was answered by discovering it
was wrong — the beta shipped, and the first reason stopped applying. The third is the one to keep:
the status line reported first, and it is what makes promotion a non-event rather than a cliff.

Three reasons, in order of weight.

1. **It is a semantic change to the most load-bearing concept in the compiler, days before a first
   beta.** That is the highest-variance change available for the lowest early payoff.
2. **Almost no beta user hits it in month one.** The feature serves teams standing up an additional
   locale over weeks. Day-one users are adding i18n at all.
3. **The status line should report first.** It tells us whether incompleteness is a pain people
   actually report, and in what shape. Building the remedy before the complaint is how the framing in
   §1 happened in the first place.

## 6. Prerequisite, already in place

`getTranslationStatus()` counts per-locale completeness from the hive — the same source
`verifyIntegrity` accepts, so the number cannot disagree with whether a build will pass. Pending
locales need exactly that to report progress, and it exists.

## 7. Open questions — all three answered

**Option shape.** _Settled: a separate `pendingLocales: string[]`._ The argument in the original
draft held up unchanged — the common case stays a plain `string[]`, and promotion is a one-line diff.
The object form would also have turned `ZintlPluginOptions` into a union across the testing harness
and thirty example configs for no gain.

**Interaction with `multiplex`.** _Automatic, and asserted rather than assumed._ Fan-out reads the
shipped list at every site (`hooks/config.ts`, `Context.getMultiplex`, the fanned-path recognizers in
`transform.ts` and `resolve.ts`, `GraphManager`'s fanned-boundary detection), so a pending locale
gets no document by construction. The `pending-locale` fixture's `dist-output` snapshot records the
result: one catalog chunk, for `ar`, and no German anywhere in `dist`.

**Does a pending locale appear in the SSR `window.__zintl_locales` payload?** _No, by the same
mechanism._ `store-server.ts` writes `store.locales`, which is set by `runInRequestScope` from the
list `ssrWrapCode` bakes in — and that comes from `this.locales`, the shipped list. Stated as read
rather than as measured: the fixture is an SPA, so no test covers this path. It is the one claim in
§3 that rests on reading the chain instead of running it.

## 8. Next steps — done

All four, in this order. §10 records where each one turned out to be different from the plan.

1. ~~Decide the option shape (§7).~~ Separate list.
2. ~~Classify all 49 reads in §4 into _maintain_ and _ship_, mechanically, before any behaviour
   changes.~~ Twenty-one reads, not forty-nine, plus `CompilerContext.locales` (§10.1). Done as its
   own step, with the full gate green before any behaviour landed.
3. ~~Add a contract fixture.~~ `tests/fixtures/pending-locale.ts`, claiming `["spa", "build"]` — no
   new capability and no new contract spec.
4. ~~Assert the literal-anchor error names it as pending.~~ `UnsupportedAnchorLocale` carries a
   `kind`, and the two mistakes get separate sections and opposite advice.

## 9. What this proposal does not cover

- The Friday problem. See §1.1 — it is out of scope because it is unsolvable without breaking 008.
- Partial shipping of a locale (ship the 90% that is translated, blank the rest). Same reason.
- Any TMS interaction. A pending locale is exactly the state a TMS is working through, and the two
  designs will meet — see [032](032-export-import-facets.md) — but neither blocks the other.

## 10. What building it changed about this document

Four things, in descending order of how much they mattered.

### 10.1 §4's measurement was stale by half, and pointed at the wrong files

Re-measured at `379f953`, three days after §4 was written:

| File                                               | §4 claimed | Actual |
| :------------------------------------------------- | :--------- | :----- |
| `packages/compiler/src/index.ts`                   | 18         | 20     |
| `packages/compiler/src/managers/CatalogManager.ts` | 28         | **0**  |
| `packages/compiler/src/managers/GraphManager.ts`   | 3          | 1      |

`CatalogManager` takes `locales` as a **parameter** at every site now, so it has no classification to
make — its caller does. Forty-nine became twenty-one.

That is the good half. The bad half is that §4 counted `this.locales` and stopped there, and the
concept had meanwhile grown a second home: **`CompilerContext.locales`**, which the `html` and
`assets` facet presets read about thirty times between them. Those are real classifications, one of
them the destructive one in §10.3, and none of them are in §4's table. Counting one spelling of a
concept measures the spelling.

Final shape: ten maintain sites in `index.ts`, two in the `html` preset, four in `assets`, one
parameter rename in `CatalogManager`. Everything else keeps the shipped list, which is the point of
§10.2.

### 10.2 Which meaning keeps the name is the whole of the risk management

§4 framed this as forty-nine classifications with a quiet failure in both directions, and left it
there. But the two directions are not symmetric, and choosing which one an _omission_ falls into is
free:

- **`locales` keeps meaning "ship"**, and a new `maintainedLocales` is introduced. A site nobody
  remembers to promote stays ship-correct. The worst outcome is that a pending locale gets no catalog
  file — the feature visibly does not work, on day one, to the person who just enabled it.
- **`locales` grows to mean "maintain"**, and a new `shippedLocales` is introduced. A site nobody
  remembers to narrow ships an untranslated locale: catalog chunk emitted, German offered, blank text
  to users. That is precisely what the no-fallback rule exists to prevent.

The first was chosen. It has a second property worth naming: with `pendingLocales` unset the two
arrays are the same array, so every project that never asks for this feature cannot be affected by a
misclassification at all.

### 10.3 Pruning is the one place a mistake destroys work, and §3 called it a table row

§3 lists "Reconciliation, pruning — Yes" beside extraction and catalog writing, as though the three
were the same kind of claim. They are not. `pruneOrphanedBoundaries` builds a set of known paths and
**deletes every file under `outputDir` that is not in it**. Handed the shipped list, a pending
locale's catalog is an orphan by construction.

Measured rather than argued: with the shipped list at that one call site, a production build deletes
`locales/src/main.de.json` outright — confirmed by spying on `IOManager.rm`. The file is not
recreated, and the translation in it is gone. The same hazard applies to `getActiveOutputPaths` in
the assets preset, where the file at risk is a translator's authored artifact rather than a catalog.

### 10.4 Two of the first tests written for this asserted nothing

Both passed against the bug they were written to catch, and both were caught the same way — by
reverting the fix and re-running, rather than by reading them.

**The prune test.** `pruneOrphanedBoundaries` returns early when the manifest hash is unchanged, so
"flush, edit a catalog, flush again" prunes nothing. The first version of the test added an
unreferenced new file between the flushes, which does not change the boundary graph's node keys and
so does not change the hash either. Only an edit that actually grows the graph makes the prune run.

**The contract fixture.** `verifyIntegrity` returns early on a graph with no entries, and an entry is
a file with a **top-level** `zintl()` call. The fixture's anchor was inside `async function
render()`, so the project had a boundary but no entry, and the build was green whatever its catalogs
said — including with Arabic 0% translated. Rewritten with a top-level anchor, breaking Arabic fails
the build with `1 missing translation across 1 locale` while German at 1/2 still passes, which is the
pair of claims the fixture exists to make.

Worth stating plainly: the reason both were caught is that every claim in this feature was falsified
before it was believed. A green test is evidence of nothing until it has been seen to fail.
