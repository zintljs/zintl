---
"@zintljs/compiler": patch
"zintljs": patch
---

A hot catalog update is no longer accepted by a page that cannot redraw from it.

On Rspack, editing a translation reached the browser and vanished. Measured in the page: the store
held the new translation and the heading held the text painted before the edit, indefinitely. This
had been recorded as a race — "the reload beats the catalog write" — and there is no race. The
catalog arrives, applies, and nothing asks the page to paint again.

Two conditions have to hold together, which is why it looked host-specific and framework-specific by
turns. Nothing in the page is subscribed to the store — a vanilla entry and Svelte's compiled output
each paint once — _and_ the host does not re-run the entry either, because Rspack's applier
deliberately invalidates nothing and rebuilds only what its declared dependencies mark stale. Vite's
applier invalidates the entry's own modules, which is why the same projects were always green there.

A generated catalog now self-accepts only when something can act on it. `BundlerFacet.hmrSelfAcceptCode`
takes a `canRepaint` argument; Vite ignores it, and Rspack declines. Declining alone is not enough,
because a fetched catalog arrives through a dynamic import — a chunk boundary with no static parent —
so it does not bubble to a reload the way declining inside an entry does; the update plan therefore
issues the reload from that same facet answer, so the module and the server cannot disagree.

`RuntimeFacet.repaintsOnCatalogUpdate` is new: a framework states whether its components redraw from
a store update. It defaults to `false` where `entryReexecutionSafe` defaults to `true`, because a
wrong `true` here yields a page that silently lies about its own contents while a wrong `false` costs
a refresh.

Ledger L-064. Catalog edits now apply on `rsbuild-vanilla-basic`, `rsbuild-vanilla-spa` and
`rsbuild-svelte-basic` — by reload, the same trade L-035 made for source files — while
`rsbuild-vue-mpa` keeps its warm path. Still open: the reactive frameworks whose managers _fetch_
rather than inline the catalog, which is L-056's inlined-vs-fetched line rather than anything about
frameworks.
