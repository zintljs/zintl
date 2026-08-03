---
"@zintljs/compiler": minor
"zintljs": patch
---

Take custody of hot updates from the watcher to the applied catalog.

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
