# `solid-basic`

`create-vite`'s **solid-ts** starter, localized. The example that shows why
subscribing a component is not always how translations become reactive.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # vp dev
pnpm build    # tsc -b && vp build
pnpm preview  # vp preview
```

Read it as "I ran `pnpm create vite --template solid-ts`, then added
localization". The page, the CSS, the `solid.svg` hero and the `#root` mount
point are the template's.

## Why Solid needed a different mechanism

A Solid component runs **once**. Its JSX compiles into fine-grained effects, and
an effect re-runs only when a signal it read during its last run changes.
`_t('…')` is an ordinary call to an ordinary function, so a Solid component can
be perfectly subscribed to the store and still never update — there is no second
render to trigger.

So `solidCodegenFacet` contributes a `reactiveBridge` rather than
`clientReactivityImports`: a module-level signal mirroring the store, spliced
into every generated `_t` call as `_v`. Rendering a translation _is_ reading that
signal, so each sink takes the dependency by construction, without the codegen
having to find them. Vue reached the same seam from the opposite direction —
its templates compile to render functions that must read something reactive —
which is the clearest evidence in the repo that the abstraction is load-bearing.

The visible consequence: **there is no `key={lang}` remount wrapper here.** React,
Preact, Vue and Svelte all use one. Solid updates the text nodes in place, and
adding a remount would throw away the fine-grained updates that are the point of
the framework.
