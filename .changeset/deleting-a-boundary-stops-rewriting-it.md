---
"@zintljs/compiler": patch
---

Deleting a boundary no longer queues its catalogs to be written back.

`removeFile` marked each removed boundary dirty. "Dirty" means _write my catalog_, so marking a
boundary that has just been deleted queued its catalogs for re-creation — and the prune, running
earlier in the same flush, had its work undone a millisecond later:

```
Pruning orphaned file: zintl/src/App.svelte.ar.json   +0ms
Writing file:          zintl/src/App.svelte.ar.json   +0ms
```

The flag was added for a real reason — a deletion during an idle moment must not sit unflushed — and
that job is already done twice over, by the explicit `scheduleFlush()` at the end of `removeFile` and
by the trailing flush a deferred flush now arms. Waking the flush and asking it to write are
different jobs, and only the first was ever wanted here. The removed boundary is now scrubbed from
the dirty set rather than added to it, and the unit test asserting the old behaviour is rewritten
rather than deleted, since its intent was right and only its mechanism was backwards.

Measured on `chaos-boundary`: `svelte-basic` goes from 5 failing runs in 10 to 2. The prune itself was
never wrong. A second writer remains and is recorded in ledger L-071 with the next probe named rather
than guessed — `Forgetting deleted file: src/AppNew.svelte` appears mid-test for the file the rename
just created, and a boundary that is forgotten and re-extracted can be reconciled back onto the old
id by content.

No new instrumentation was needed to find this: `safeWriteFile` already logged every write through
the same logger as the prune's decisions. Nobody had read the two in order.
