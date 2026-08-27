---
"@zintljs/compiler": patch
---

Refuse a build where a localized artifact and a translation catalog want the same file.

Both are named `<outputDir>/<path>.<locale>.<ext>`, so targeting `.json` — the extension catalogs
themselves use — can put an artifact exactly where a boundary's catalog goes. `assetsTarget:
["json"]` with an asset at `src/data.json` and a boundary in `src/data.ts` sends both to
`zintl/src/data.ar.json`, and this succeeded:

```
zintl/src/data.ar.json   ← the catalog. Written second; the artifact is gone.
```

Which is the worst of the available outcomes, because it looks like success. The artifact _becomes_ a
catalog, so `verifyIntegrity` finds a non-empty file and passes, and the asset ships in the source
language with nothing said — a source-locale fallback nothing downstream can detect, which is the one
thing this project's first rule forbids.

It is now a hard error naming the file, the facet that claimed it, the boundary whose catalog it is,
and the way out:

```
[Zintl] A localized artifact lands on a path Zintl already writes a catalog to.

  zintl/src/data.ar.json
    claimed by "system-static-assets", and by the catalog for "src/data"

Fix:    give the artifacts their own location, away from the catalogs —
        assetsTarget: [{ targetPattern: "**/*.json",
                         outputPattern: "assets/[locale]/[dir]/[name].[ext]" }]
Or:     stop targeting this extension, or rename the source file.
```

**Paths are what is refused, not extensions.** `assetsTarget: ["json"]` is safe in a project whose
catalogs live in one multilingual file and unsafe in the default one, so an extension check would be
both too strict and too loose. The guard indexes every path the boundary graph will write a catalog
or schema to and refuses only on an actual overlap.

It runs in `runFlush` rather than in the pruning scan, which had both sets in hand: pruning is gated
on the `prune` option and short-circuits in dev, and a correctness guard an unrelated option can
switch off is not a guard. The scan also could not have found this — it _unions_ catalog paths with
content-facet outputs, and a union cannot show an intersection: two subsystems writing one file
looked exactly like one subsystem writing it twice.

Settles proposal 034 §6.
