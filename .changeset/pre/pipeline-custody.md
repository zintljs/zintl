---
"@zintljs/compiler": minor
---

Make the compiler's own stages recoverable, ordered and accountable.

The flush and the graph rebuild were the compiler's versions of the two defects the runtime had: one collapsed concurrent callers onto work that did not include their changes, the other let whichever rebuild _finished_ last decide the world.

- **A failing flush no longer poisons every later one.** `flushPromise = null` was the last statement _inside_ the async body, so a single throw left a rejected promise cached and every subsequent flush returned that same rejection for the life of the process. `verifyIntegrity` throws by design on a missing translation, and the hot-update hook swallows the result with `.catch` — so a compiler could stop flushing entirely and nothing would say so. Now cleared in a `finally`.
- **A flush no longer destroys work it never adopted.** The run snapshotted `dirtyBoundaries` near its start and cleared the whole set near its end, so a boundary dirtied _during_ the run was not deferred — it was discarded, and no later flush knew it existed. Only the boundaries a run actually adopted are cleared.
- **A caller arriving mid-flush gets a follow-on**, not the in-flight promise. Awaiting someone else's run resolves to "their work finished", which is not what the caller asked (Axiom D3).
- **A graph rebuild that was overtaken discards its result.** `graphDirty` is cleared _before_ the async body runs, so a transform during a rebuild starts a second concurrent one; both then assigned `boundaryGraph`/`chunkGraph` and the winner was whichever finished last. Rebuilds genuinely replace state, so D1 applies here — unlike invalidation, which accumulates (ZDB §4.1a).
- **The hive is written by the flush.** It had its own debounce on the same 300 ms constant, with nothing sequencing the two, so a burst of edits could write the hive from a state the flush had not reconciled. The timer survives only as a fallback for when no flush follows.
- **Pipeline diagnostics are no longer written to a field nobody reads.** `resolve` and `apply` have always produced a structured `Diagnostic[]` — overlapping rewrites dropped, duplicates merged — and every one was discarded. A dropped rewrite is a source mutation that did not happen. Warnings, errors and validation failures now reach the ledger; `info` is skipped, because a ledger reporting routine work is one nobody reads.

**Two regressions found by measurement, not review**, both worth knowing before touching this again.

The first: an unconditional follow-on flush **livelocks**. The flush body reaches back into the compiler — `syncGraphs` asks content facets for translations, which can transform, and `transform` schedules a flush — so each run dirtied just enough to justify the next. It presented as a dev server that stopped pushing updates and a contract timing out at 45 s, a long way from where it started. The follow-on now runs only when something is genuinely still unflushed.

The second was in the runtime, and only a full-suite run under load exposed it: `__zintlApplyHtml` and the `localStorage` write happened **before** a locale switch claimed the active-locale slot, so a switch that was then superseded rewrote `documentElement.lang` anyway. The page rendered Arabic while announcing itself as English, and `locale-switch` and `locale-storm` both caught it. Claim and publish now happen in one synchronous block: claims are ordered, so whichever switch claims last also publishes last, and the document ends up describing the locale the store actually adopted.

`hmr-hammer` remains intermittently red under full four-worker load with the signature proposal 024 §1.1a records — fewer packets than there were writes. That is the pre-existing failure the proposal measured at roughly one full-suite run in five, and it is upstream of anything here: the loss is a packet the watcher never produced, not one delivered out of order.
