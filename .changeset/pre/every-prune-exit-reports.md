---
"@zintljs/compiler": patch
---

Every exit from catalog pruning now reports why.

`pruneOrphanedBoundaries` had three silent paths out and one that logged. "The prune did not delete a
file" therefore had at least four indistinguishable causes from outside — it never ran, the `prune`
option is off, development sessions skip it by design, the known-path set was unchanged, or it ran
and considered the file live. Ledger L-065 spent an investigation on that ambiguity and reached the
wrong conclusion twice.

All of them speak now, at debug level and — for the two that were already reported to the delivery
bus — consistently with each other. The per-file decisions log too, `Pruning orphaned file:` beside a
new `Keeping (known):`, because when the survivor is a catalog whose source was deleted, _which_
seeding step claimed it is the whole question.

This is instrumentation, not a behaviour change: no file is pruned or kept differently.

What it immediately found is recorded as ledger L-070. The prune is not the defect — it runs once,
correctly, and is then never asked again, because a flush that arrives while another is in flight is
deferred to "the next trigger" and the last change before a quiet period has no next trigger. That
signal, `flush #N → superseded (joined the in-flight flush; dirt retained for the next)`, appears 68
times across this session's captured diagnoses and had been read as background noise throughout.
