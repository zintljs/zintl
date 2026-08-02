---
"@zintljs/compiler": minor
---

Order and account for every catalog and locale change in the runtime.

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
