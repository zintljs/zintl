---
"@zintljs/compiler": minor
"zintljs": patch
---

Tell the compiler when a file is deleted.

Nothing ever did. The bundler handles `unlink` separately from `change` — it removes the module from its own graph and reloads, but never calls `handleHotUpdate` or `hotUpdate` — and the plugin registered no watcher of its own. A deleted boundary therefore stayed in the compiler's graph and manifest for the life of the process.

That is worse than stale state, because dev servers are pooled per worker: the orphan outlived the thing that created it. In the contract suite it leaked into every later contract's graph snapshot, and through the compiler's persisted manifest it reached the **committed examples** — twelve generated JSON files describing source that no longer existed, from a single test run.

`ZintlCompiler.removeFile()` forgets the file and everything it owned: manifest entries, boundary ownership, metadata and dependency graph entries, catalog caches, boundary revisions, and the graph nodes themselves. `MessageManager.trackBoundaryChange` already knew how to drop the boundaries a file no longer owns — passing it an empty set is exactly "this file owns nothing now", and the gap was only ever that a deletion never reached it. The removed boundaries are marked dirty as well: pruning finds orphans by comparing the output directory against the live graph, but the flush still has to be told something changed, or a deletion made during an idle moment sits unflushed until an unrelated edit wakes it.

The watcher is registered in `configureServer`, deliberately **before** the `appType === "custom"` early return. That exit skips the multiplex middleware, which SSR apps do not want — but they do want their deletions noticed, and registering after it would have left every SSR project with the exact bug this listener exists to fix.

**`chaos-boundary` is live again on three of four projects.** It had been skipped entirely; it now runs and passes on `react-basic`, `vue-basic` and `vanilla-spa-basic`, with the graph snapshots and the committed examples verified clean afterwards — which is the check that matters, since the leak's damage was always downstream of the contract that caused it.

Contracts can now declare `pendingFor` — a per-project gap, keyed by manifest name. A blocker is rarely uniform: skipping all four projects to describe a failure on one throws away the three that work, which is the same loss as marking the whole thing green would be, in the other direction. `chaos-boundary` uses it for `svelte-basic`, whose remaining failure is proposal 024 §1.3 — the entry self-accepts, re-executes and mounts twice — and needs a framework-side `hot.dispose()`, not anything here.

**Unrelated, and pre-existing:** `performance-size` failed once in seven runs during this work, at 10,972 bytes against a 10,240 budget. It is not a regression — it passes in isolation and in six of seven full runs — but it is not measuring what its name suggests either. It captures _dev-mode_ response bodies inside a timing window (its own comment sizes the budget for "Vite dev-mode wrapper overhead"), so which responses land in the window varies. Like `performance-hmr`, it is a smoke check shaped like a budget, and it will get less meaningful as more examples are added rather than more.
