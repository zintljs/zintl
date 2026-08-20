---
"@zintljs/testing": patch
---

Make `hmr-hammer` distinguish a coalesced watcher event from a delivery failure, and stop truncating
files mid-burst.

The delivery assertion added in the previous release failed on a project where the host reported only
three watcher events for five edits — all carrying the same byte count, none carrying the final
content. The last edit was never reported at all, so blaming delivery blamed Zintl for an event it
never received.

Two changes. The burst's intermediate writes are atomic rather than truncating: mixing raw
`writeFile` with a final atomic rename inside ~100ms lets chokidar's atomic-save detection collapse
two saves into one event, and it was dropping the burst's final write. And before asserting delivery
the contract now waits for the host to report content of the final size, failing distinctly — and
naming watcher coalescing — when it does not.

Also fixes a failure message that printed `Bodies received for {}`, because the URL matcher had become
a `RegExp` and `JSON.stringify` renders those as an empty object.

Measured 0 failures in 10 under the CPU contention that produced the original failure.
