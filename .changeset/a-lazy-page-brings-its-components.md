---
"@zintljs/compiler": patch
---

Give a lazily-routed page's own components their catalogs.

Two different walks answer "what does this chunk reach dynamically", and they disagreed.
`computeTranslationChunks` records the full set on the chunk; the set the catalog collection actually
used came from `getReachableHandshake`, which stops earlier. For a lazy route made of components the
page arrived and the components it renders did not — so a sidebar and a table of contents behind a
lazy route had catalogs on disk, a green `verifyIntegrity`, and empty text in every locale but the
source.

The collection now takes the union of the two rather than only the caller's set. Neither is a
superset of the other — the caller's is computed from an anchor and can name boundaries the chunk
walk does not — so dropping either would trade this defect for its mirror image.

Found by the documentation site, whose docs shell is exactly that shape: one lazy route rendering a
sidebar, a table of contents and a pager.
