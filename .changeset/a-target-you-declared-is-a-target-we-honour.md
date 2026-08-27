---
"@zintljs/compiler": patch
"zintljs": patch
---

Honour a configured `assetsTarget` everywhere, not only where the default one happened to be looked for.

`assetsTarget` has been configurable for some time, and three places never asked what it said. Each
tested `.md` and `.txt` by hand — which is not a fact about assets, but the _default_ value of the
option — so a project targeting anything else got a different feature from the one it configured.

**A boundary carrying only a non-default asset generated no manager at all.** The pipeline decided
whether a boundary had any translations worth loading by scanning its dependencies for `.md` or
`.txt`. Target `.rst`, and the answer was no: no manager was emitted, no catalog was ever requested,
and the page rendered a pseudo-localized key. The only clue was `no manager provided` in the console,
four layers from the cause. This is the one with user-visible consequences, and it was invisible to
every test because every asset in the repository was a `.txt`.

**Editing a non-default artifact did nothing.** The hot-update classifier recognised sources by
extension, catalogs by `.json`, and assets by the same two-item list. An edit to `about.ar.rst` was
classified as no kind of change at all, so no update ran and the browser kept the previous text until
a reload.

**Orphaned artifacts of non-default targets were never reclaimed.** The scan that removes files under
`outputDir` whose source is gone matched `.json`, `.md` and `.txt`. Anything else outlived its source
indefinitely, unreferenced and unexplained.

All three now ask the facet layer, which is the thing that actually knows. `ContentFacet` gained
`extensions` in the previous release for exactly this reason and the compiler gained `ownsContent`;
these are the callers that should have been using them. The pipeline is handed the predicate with its
context already bound, so a hot traversal pays for one closure rather than a context per dependency
edge.

**Found by a fixture, not by reading.** `assets-authored` localizes a `.rst` and a `.png` — neither
in the default targets — and the first thing it did was fail. Proposal 034 §1.1 counted six sites
that re-derived behaviour from a file extension and called the option "honoured on one path out of
six"; it had been looking only at the assets preset and the plugin's resolve hooks. Three more were
in the pipeline, the HMR classifier and the catalog pruner.
