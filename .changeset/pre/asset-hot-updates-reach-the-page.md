---
"@zintljs/compiler": patch
"zintljs": patch
---

Editing a localized asset now updates the page (ZHMR §5).

It never did, on either host, and the same symptom had three independent causes stacked on top of
each other — fixing any one alone changed nothing visible, which is why the section survived being
specified and implemented for as long as it did.

**The compiler never re-read the file.** Asset text lives in the hive, and only `syncGraphs()`
refills it. The asset branch of `invalidateFile` announced the affected boundary and scheduled a
flush — both about delivery — without marking the graph dirty, so the whole cascade ran correctly
against the previous contents of the file.

**The text lived in a second module neither host would rebuild.** The generated catalog held an
imported binding rather than the text, and that import is minted under an extension-free virtual id
so no host can misclassify it by extension. A virtual module has no file, so Vite's graph cannot
associate it with the changed asset, and Rspack has no declared dependency to call it stale. In
development the text is now inlined into the catalog, which deletes the second module instead of
trying to synchronise it across two mechanisms that share nothing. Production keeps the import, where
one shared module per asset is right; the dev-transform snapshots move by exactly that substitution
and the production snapshots are untouched.

**The correct catalog was delivered and then rejected.** With the above fixed, the rebuilt catalog
carried the right text and the same generation as the one already applied, so the runtime discarded
it by Axiom D1 — the most misleading of the three, since every component was behaving correctly. An
asset edit now advances `catalogGeneration` like any other change.

`ContentFacet.getDeclaredInputs` is new: a virtual boundary is contributed rather than extracted, so
`boundaryOwnership` cannot say what it derives from, and it therefore declared no inputs at all. A
facet can now name the files behind its virtual boundaries, which is what makes a generated catalog
go stale on a host that rebuilds from declared dependencies.

Ledger L-067. `[Asset HMR] assets-basic` is green on both halves — the translator's edit to
`about.ar.txt` and the developer's edit to `about.txt`. On Rspack the failure has moved rather than
gone: store and DOM both carry the new text seconds after the edit, and a later rebuild restores the
old one, which is L-064's reload-beats-the-catalog-write shape rather than an asset defect.
