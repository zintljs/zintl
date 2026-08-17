---
"@zintljs/compiler": patch
---

Vue components now redraw when a new catalog arrives.

They never did. `_t('…')` is an ordinary call to an ordinary function, and Vue re-renders on reactive
dependencies it read during render — so a delivered catalog was invisible to a Vue template by
construction. Nothing was broken; a capability was missing. It stayed hidden because Vite's applier
re-runs the entry on every boundary update, remounting the tree for unrelated reasons, and because a
manager that _inlines_ its catalog updates the entry anyway. Only a fetched catalog on Rspack left
nothing to re-run.

`CodegenFacet.reactiveBridge` is new, and it contributes two halves because either alone is
insufficient — a component can be perfectly subscribed and still never redraw if nothing it
_rendered_ was reactive:

- `setup` establishes a `shallowRef` seeded from `getStoreVersion()` and kept in step by a
  `subscribe()` whose unsubscribe is handed to `onScopeDispose`, so instances do not leave listeners
  behind.
- `read` is spliced into every generated `_t` call as `_v: __zintl_v.value`, so rendering a
  translation _is_ reading the handle. Splicing at the call site rather than asking the codegen to
  find its own sinks is what makes it total, and `_t` ignores options it does not know, so a dialect
  without a bridge is unaffected.

**A latent render loop is fixed alongside it**, because the bridge closed the circuit on one already
present. `_t` triggers a hydration load when a key is missing and re-reads immediately, which is what
lets a synchronous loader satisfy the first render tick. When the key is genuinely absent, every
render triggered another load, every load could `addCatalogs`, and every `addCatalogs` notified —
open with nothing subscribed, closed the moment a framework read the store during render. Measured at
167,280 console messages in one `chaos-catalog` run, which deletes the catalog on purpose. React's
recorded version of this is ~700 messages in twelve seconds.

`I18nStore.claimHydrationAttempt` allows one attempt per locale/boundary/**key**, never cleared.
Keying on the boundary and clearing on catalog change was tried first and re-armed the loop exactly:
the load does deliver the boundary, it simply does not contain that key. Keying on the key is what
makes "never cleared" safe — the guard gates only the miss path, and a key that later arrives is no
longer a miss.

Ledger L-069. `[Catalog Edit]` is green on all twelve claimants across both hosts.
