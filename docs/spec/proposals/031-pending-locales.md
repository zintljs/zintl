# Proposal 031: Pending Locales

**Status**: DEFERRED — designed, not built. Deliberately post-beta. The prerequisite
(`getTranslationStatus()`) shipped; the feature did not, for the reason in §5.
**Date**: 2026-08-24
**Kind**: Design proposal, with a rejected framing kept on purpose (§1).
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

| File                                               | `this.locales` reads |
| :------------------------------------------------- | :------------------- |
| `packages/compiler/src/index.ts`                   | 18                   |
| `packages/compiler/src/managers/CatalogManager.ts` | 28                   |
| `packages/compiler/src/managers/GraphManager.ts`   | 3                    |

Forty-nine classifications, and the failure mode of getting one wrong is quiet in both directions: a
locale that ships when it should not, or one that silently stops shipping. Neither throws.

## 5. Why it is deferred

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

## 7. Open questions

**Option shape.** A separate `pendingLocales: string[]`, or `locales` grows an object form
(`{ locale: "de", pending: true }`)? The separate list keeps the common case a plain `string[]`, which
is most of the argument for it. It also makes promotion a one-line diff a reviewer can read.

**Interaction with `multiplex`.** Per-locale HTML fan-out builds one document set per locale. A
pending locale must not get a document, which is probably automatic once it is out of the shipped
list — but it is a distinct code path and should be asserted rather than assumed.

**Does a pending locale appear in the SSR `window.__zintl_locales` payload?** It should not, by the
same rule as the runtime locale list, and `store-server.ts` writes that from `store.locales`.

## 8. Next steps, when this is picked up

1. Decide the option shape (§7).
2. Classify all 49 reads in §4 into _maintain_ and _ship_. Do this as its own commit, mechanically,
   before any behaviour changes.
3. Add a contract fixture: a project with one pending locale, asserting **no catalog chunk is
   emitted**, the runtime locale list **excludes it**, and the build **passes at 0% translated**.
4. Assert the literal-anchor error names it as pending. An anchor on a pending locale is a different
   mistake from an anchor on an unknown one, and the message should say which.

## 9. What this proposal does not cover

- The Friday problem. See §1.1 — it is out of scope because it is unsolvable without breaking 008.
- Partial shipping of a locale (ship the 90% that is translated, blank the rest). Same reason.
- Any TMS interaction. A pending locale is exactly the state a TMS is working through, and the two
  designs will meet — see [032](032-export-import-facets.md) — but neither blocks the other.
