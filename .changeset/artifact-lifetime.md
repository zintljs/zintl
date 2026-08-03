---
"@zintljs/compiler": patch
---

Give written artifacts an owner, and stop the test scratch trees growing forever.

The author's account of this class was "a very little ones just shock the system and live for ever in a disk category". Two of those were measurable in the repository itself.

**The test scratch trees.** `createZintlContext` returned a `cleanup` that was an empty function. Every test dutifully awaited it in `afterEach` or `afterAll`, and every run left its directory behind: **5,308 directories, 53 MB**, invisible because `.tmp` is gitignored. A second helper, `createTestDir`, had no cleanup at all and no caller that removed anything, adding another ~20 MB of `html-deep-*` and friends to a different `.tmp` at the repository root. Two independent scratch trees, both unbounded, both hidden.

A cleanup contract that callers honour and the implementation ignores is worse than no contract — it makes the leak invisible to exactly the people looking for it. `cleanup` now removes the directory, the two helpers share one temp policy, and the base is cleared once per worker on first use so a context whose `cleanup` is never called costs one run rather than every run. Per-worker matters: Vitest runs workers as separate processes against one working directory, so a shared base would let whichever worker started last delete directories the others were still using. Measured across three consecutive full runs afterwards: **40–96 KB, stable.**

**Pruning consulted a branch that could not run, and would have thrown if it had.** `pruneOrphanedBoundaries` declared a `contentFacets` parameter that its only call site never passed, so the content-boundary protection was unreachable; and the call inside it passed a boundary's metadata where the facet contract declares a `CompilerContext`, so the moment it became reachable it threw `context.getMetadataGraph is not a function`. Two faults hiding each other — dead code does not get to be correct by never running. The facets now come from the field the manager already holds rather than an argument a caller has to remember, and the context is built in the shape the hooks actually read.

**A prune could be skipped because a counter matched.** The skip key hashed the _size_ of the active content-path set, so swapping one content path for another left it identical and the prune that should have reclaimed the old output never ran. It now hashes the contents.

**Every write and removal has an outcome.** `safeWriteFile` settles on all three paths — written, skipped as already identical, failed — and `rm` settles too, because an output that vanished and one that was never written look identical on disk. Only the ledger separates them, which is "artifacts outliving their source" in reverse.

**Pruning in development is named, not enabled.** It is disabled outright for real dev sessions, so a deleted source's catalogs survive the whole session. Turning it on is not a flag flip: `chaos-boundary`'s rename and delete body is commented out behind a "Fix Pruning Left-Over Catalogs on File Deletion" note, which says the reachability question this depends on is still open. Trading an accumulating leak for the chance of deleting a live catalog is much worse, so the staleness gets a name in the ledger instead.

Also removes two stray artifacts that had been tracked in git since July: an empty `pipeline/task.md` and `pipeline/intent.ts.clean_anchor.txt`.

**A Phase 3 revision.** The follow-on flush is gone. Its stronger reading of D3 — the caller's own promise resolving when its work lands — cost a full extra flush per hot update, because `runFlush` transforms and `transform` schedules a flush, so every run left a timer that fired afterwards. That timer is now cancelled when nothing is left to flush. What made the original defect a defect was the _destructive clear_, and that fix stays: a mid-flush caller's boundaries survive for the next run rather than being wiped. ZDB §4.3 now says explicitly that deferral satisfies D3 and only destruction violates it.

**On the measurements.** Contract failures during this work were chased for a while as regressions. They were not: re-running the pre-change baseline under the same conditions produced _more_ failures (8 across five contracts) than the new code (1), because the machine had been running suites back-to-back for hours. This is exactly the trap proposal 024 §7 records — "measure on a quiet machine … that data was worthless and nearly sent the investigation after a phantom". The follow-on removal above rests on the livelock, which is reproducible in a unit test, and on the mechanical fact of the doubled pass; not on the contaminated parallel data. Re-run the gates on a quiet machine before trusting any contract-level conclusion here.
