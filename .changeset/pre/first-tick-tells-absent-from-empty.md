---
"@zintljs/testing": patch
---

`hmr-first-tick` no longer reports an absent element as a blank render, and asset HMR reclaims Rspack.

The contract sampled the heading with `document.querySelector(sel)?.textContent ?? ""`, which yields
`""` for an element that is **absent** exactly as readily as for one that is empty. On an app that
clears its container, `await`s a dynamic import and then paints, that reads as
`"Lazy colony"` → `""` → `"First tick works!"` — which was written up as ZHMR §6's "Blank/Empty
Rendering on First HMR Update" and entered in the ledger as a product defect. It was neither: for the
duration of the await there is simply no heading in the document, no translation is involved, and no
catalog is late.

The two states are now distinguished. What §6 actually describes still fails the contract — the
element **present** with empty text, which is what a resolver miss looks like when there is no
source-locale fallback. Green on all nine projects, 0 failures in 10 runs. Ledger L-060 is withdrawn
with the reasoning kept, because a probe that cannot tell _not rendered yet_ from _rendered as
nothing_ will manufacture defects in every asynchronously repainting app it meets.

`[Asset HMR] rsbuild-vanilla-basic` also returns, unrelated to any asset change: it was pending on a
later rebuild restoring the old text, which was L-064 — an update nothing in the page could act on.
Fixing that cleared this. Measured 0 failures in 10 runs, so ZHMR §5 now holds on both hosts.
