---
"@zintljs/compiler": patch
---

Stop invalidating a boundary whose source could not be parsed.

When a hot update re-extracts a changed file and the parse fails — a file saved mid-keystroke, which
is the most ordinary input a dev watcher sees — the failure was logged and then ignored: the file's
boundaries were marked dirty, their catalog caches dropped, their revisions bumped, and
`catalogGeneration` advanced. All of those assert that new content was read, on the strength of
content that could not be read at all, and `catalogGeneration` is what the runtime uses to decide that
an arriving catalog is newer than the one it holds.

A parse failure now leaves the boundary exactly as it was and records the outcome on the delivery bus,
so "left alone because its source could not be read" stays distinguishable from "invalidated". The
next parseable edit re-extracts normally.

Invisible on Vite, where the next edit re-extracts and the whole module chain is pushed fresh; it
surfaced when Rspack's watch hook began handing unparseable files straight to invalidation.
