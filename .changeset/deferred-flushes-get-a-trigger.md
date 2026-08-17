---
"@zintljs/compiler": patch
"@zintljs/testing": patch
---

A flush deferred by another flush now gets a trigger of its own.

`flush()` hands a mid-flush caller the in-flight promise and settles `dirt retained for the next`,
justified by "the debounce timer is already scheduled by the `transform` that dirtied it". That holds
for every trigger except the last one: `scheduleFlush()` _replaces_ the timer, and when it fires
`flush()` clears it, finds a run already in flight, and returns — leaving nothing scheduled. If no
further change arrives, the retained dirt is never flushed at all.

Measured on a boundary rename: two flushes, one catalog prune that ran _before_ the rename, and a
catalog write that simply never happened. The signal for it,
`flush #N → superseded (joined the in-flight flush; dirt retained for the next)`, appears 68 times
across one session's captured diagnoses and had been read as background noise throughout.

`armTrailingFlush` re-arms the **debounce timer** once the in-flight run settles, rather than running
a follow-on flush. That is the difference from the two attempts this replaces: further changes
coalesce into the timer, so a burst costs one extra pass at the end rather than one per update. It
cannot livelock, because nothing is armed unless dirt actually remains, at most one arm exists per
in-flight run, and a trailing flush that leaves the dirt unchanged does not arm another — while a
real edit clears that guard so genuine work is never refused. `hmr-hammer`, the contract the earlier
follow-on destabilised, measures 0 failures in 10 runs.

`noOrphanedCatalogs()` needed fixing to see any of this: it read the filesystem the instant the DOM
settled, mid-way through work already scheduled. Awaiting `flush()` once is not enough either, since
a mid-flush caller receives the in-flight promise. `flushUntilQuiescent` loops on the dirty set
rather than a clock, so it terminates because there is no dirt left rather than because time passed.

`[Chaos Boundary] vue-basic` passes 10 runs in 10. `svelte-basic` stays pending for an unrelated
defect the shared skip had been hiding — proposal 024 §1.3's double mount, measured 6/10 under
contention and 0/10 in isolation.
