---
"@zintljs/compiler": patch
---

Store subscribers now follow the active store instead of being stranded on the one it replaced.

`subscribe()` resolves through `getActiveInstance()`, which falls back to a module-level default
store until something calls `setActiveInstance`. Anything that renders before the entry's `zintl()`
resolves therefore subscribes to _that_ store — and the swap reassigned the pointer without taking
the listeners with it. The subscription survived, aimed at an object nothing would ever notify again.

Measured on `rsbuild-react-basic` after a catalog edit: the store held the new translation, `notify()`
had run twice, and `listeners` was `0` with React's `useSyncExternalStore` demonstrably mounted. The
consequence is invisible until something arrives that only a subscriber could act on, which is
exactly what a hot catalog update is.

`I18nStore.adoptListeners` moves them across on the swap and notifies once, since a subscriber whose
store changed underneath it has by definition missed a snapshot.

This is host-neutral runtime code that could only be observed on one host: Vite's applier invalidates
the entry's own modules on every boundary update, so React remounts and re-subscribes and the strand
is repaired constantly by a mechanism that exists for another reason. Rspack's applier re-runs
nothing, so it is permanent.

Ledger L-068. `[Catalog Edit] rsbuild-react-basic` passes. Vue is unaffected and remains open for a
different reason: its templates call `_t()` directly, which is not a reactive dependency, so nothing
re-renders on a new catalog — a missing reactivity bridge rather than a stranded subscription.
