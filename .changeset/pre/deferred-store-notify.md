---
"@zintljs/compiler": patch
---

Stop a hot update from wedging the browser tab.

`_t` resolves a missing key by triggering the boundary's load and re-reading it in the same
expression, because after a hot update the new catalog is available on that very tick — the manager
inlines the anchor's locale, so the load completes synchronously. That is wanted. What was not wanted
is the announcement travelling with it: `_t` runs during render, so notifying subscribers there is a
`setState` during render. Every re-render ran `_t` again and announced again, and the page ended up in
an unbounded update loop — measured at roughly seven hundred React errors in twelve seconds, with the
tab unresponsive.

Applying and announcing are now separate. `addCatalogs` stays synchronous, so the re-read still works;
`notify()` defers to a microtask and coalesces, so a burst announces once, after the caller's turn.
The store's `version` moves inside that microtask too — it is React's snapshot, and a snapshot that
changes mid-render makes React re-render to reconcile it, which would re-arm the same loop more
quietly.

Subscribers are therefore notified a microtask later than before. Nothing waits on that synchronously
except tests, which now await a tick.
