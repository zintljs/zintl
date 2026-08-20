---
"@zintljs/testing": patch
---

Stop the HMR performance budget measuring the machine, and extend both performance contracts to
Rspack.

`performance-hmr` asserted an absolute wall clock — 350 ms locally, 1,500 ms whenever CI or parallel
workers were detected. That 4× relaxation was the admission: a threshold loosened because the machine
is busy is measuring the machine. It was the suite's most frequent false red, failing at
1,893-3,689 ms during a busy session and passing 5 of 5 in isolation immediately after.

It now prices the **host's own** round trip in the same lab moments before the real edit — an edit
that changes the file and no translatable string — and compares the two, so a busy box inflates both
and cancels. Both sides are timed to the same observable, the `update` packet on the wire; timing one
to a packet and the other to the DOM would put render time on one side of the ratio only. Measured
warm: 1.2×, 1.2×, 1.3×, 2.0×.

Two things this exposed, both recorded in the ledger. A baseline edit that is genuinely a no-op is
**not host-neutral** — appending whitespace is nothing to an SFC, and a comment inside Vue's
`<script setup>` is nothing to a plugin that compares compiled output — so it is declared per project
as `HmrAdapter.perfNoopEdit`. And the first edit in a lab is not a round trip like the others: without
an untimed warm-up, the treatment measured _faster_ than its own baseline on two projects.

With both performance contracts now host-neutral, four Rsbuild projects claim `performance`.
`performance-hmr` additionally requires `hmr-warm`, because a project that reloads rather than
hot-replaces is not timing a hot update.
