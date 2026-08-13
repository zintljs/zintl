---
"@zintljs/compiler": minor
---

A non-reactive entry no longer claims it can hot-replace itself on Rspack (ledger L-035), which closes the empty-render defect for vanilla apps.

`RuntimeFacet.entryReexecutionSafe` asks whether re-running an entry is _harmless_. Nothing asked whether it is _sufficient_, and on Webpack those differ: a re-executed entry reads its imports from the module cache, so it can seed a fresh store from a manager that has not been replaced yet. A framework app survives that — a subscribed component repaints when the catalog lands a moment later. An app with no client reactivity has only the re-execution, so it rendered empty and stayed that way.

`BundlerFacet.hmrInjectionCode` now receives a `hasClientReactivity` argument, and `rspackFacet` requires it alongside `entryReexecutionSafe`. A non-reactive entry declines to accept, the update bubbles, and the page reloads — slower than a hot update and correct, which is the trade `viteFacet` already makes for frameworks whose mount is not replayable. Vite ignores the argument, because re-importing an entry there re-fetches the whole dependency chain and re-execution is always sufficient.

`examples/rsbuild-spa` claims `hmr` and `hmr-stress` again.
