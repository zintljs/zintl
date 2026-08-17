---
"@zintljs/testing": patch
---

`chaos-boundary` waits for the compiler to forget a deleted file before asserting on disk.

A deletion reaches the compiler through the host's watcher, which is asynchronous and outside the
harness's control. Until the `unlink` lands the boundary is still live, still in the prune's
known-path set, and its catalogs are correctly _kept_ — so reading the directory first asserts on a
state that was never wrong. `boundaryForgotten` terminates on the condition rather than on a clock,
and turns a watcher that never fires into a precise failure instead of a puzzling orphan list.

It did not fix the flake it was written for, and that is recorded rather than glossed: `svelte-basic`
moved from 5/10 to 6/10 failing, which is noise, and the wait passes on every failing run. The
assertion was not racing the watcher.

**What the investigation did establish is a corrected diagnosis.** This contract's header has long
attributed `svelte-basic`'s failure to proposal 024 §1.3 — the entry re-executing and Svelte's
`mount()` appending a second copy. Measured, every failure is the orphan assertion instead, and the
instrumented prune shows the files deleted correctly and then present again by the time the assertion
reads them. Something re-materialises the catalogs of a boundary already reclaimed; the writer has not
been identified, and `removeFile`'s `markDirty` — the obvious candidate — was tried and reverted,
because it moved the rate only within noise and a unit test states its opposite intent outright.

Ledger L-071 carries the measurements and names the next probe: a timestamped log of catalog writes
interleaved with the prune's decisions. Both halves are already instrumented; their order is what is
missing.
