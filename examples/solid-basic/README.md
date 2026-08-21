# `solid-basic`

`create-vite`'s **solid-ts** starter, localized. The example that shows why
subscribing a component is not always the way to make translations reactive.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # vp dev
pnpm build    # tsc -b && vp build
pnpm preview  # vp preview
```

## Why Solid needs a reactive bridge

A Solid component runs **once**. Its JSX compiles into fine-grained effects, and
an effect re-runs only when a signal it read during its last run changes. So the
React mechanism — inject `useSyncExternalStore` into the component and let the
framework re-render it — has nothing to act on here: there is no second render.

`solidCodegenFacet` therefore declares a `reactiveBridge` instead. A module-level
signal mirrors the store, and its read is spliced into **every** generated `_t`
call, so rendering a translation _is_ taking the dependency. No sink can be
missed, because the codegen never had to go looking for them.

The observable consequence is the nicest one in the suite: switching locale here
**does not remount anything**. Click the counter a few times, switch to Español,
and the count is still there — every other framework example wraps its tree in a
`key`/`{#key}` and throws that state away. It is worth doing once by hand.

## What this exposed

Solid was the first JSX dialect _without_ a hook, and it found a real defect:
the compiler injected `useSyncExternalStore(...)` into any file with component
functions, gated only on server components. Vue and Svelte escaped because their
SFCs have no component functions to find — a property of their file format
rather than a decision. Solid did not, and got a call to an undefined name.
The injection is now gated on the framework having declared a hook to call.

## What is not vendored

The Solid logo — see [`../preact-basic/README.md`](../preact-basic/README.md) for
why the hero carries the neutral shape and the Vite logo only.
