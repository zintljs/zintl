# `rsbuild-vue-spa`

`create-rsbuild`'s **vue-ts** starter with `vue-router`, localized. The routed
counterpart of [`rsbuild-vue-basic`](../rsbuild-vue-basic).

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # rsbuild dev
pnpm build    # rsbuild build
pnpm preview  # rsbuild preview
pnpm check    # vue-tsc
```

## Why it exists

One lazy route. `/about` is a `() => import(...)` component, so its strings
belong to a boundary the entry never imports statically — and Zintl emits their
catalog behind the same dynamic import Rspack uses for the component.

[`rsbuild-vanilla-spa`](../rsbuild-vanilla-spa) asks that question of a hand-rolled
router; this one asks it of a framework router, which is the combination a real
Vue app has. Measured here: navigating to `/about` in Arabic loads a chunk that
was not in the initial bundle and renders it fully translated, RTL.

Two small things carry the locale across the boundary, and neither is Zintl's
doing — they are what any Vue router app has to do:

- `router.beforeEach` re-attaches `?lang` to every navigation, so the locale
  survives a route change.
- `<Suspense>` around `<router-view>` in `src/App.vue`, because a lazily-resolved
  route component is async.

## `<script setup>` is required

As in every Vue example here, and on both hosts — see
[`rsbuild-vue-basic`](../rsbuild-vue-basic#script-setup-is-required-on-both-hosts)
for why an Options-API component fails with `_ctx._t is not a function`.

`src/components/AboutWorld.vue` is worth a look for the edge of that rule: it
needs no script at all, and still declares an empty `<script setup>`. Without the
block, Vue compiles the template as its own module and the same error appears —
so on a template-only component the empty block is load-bearing, not leftover.

## Status

Supported for single-page apps in build and dev. SSR and `multiplex` are not on
this host — see
[proposal 030](../../docs/spec/proposals/030-rsbuild-what-remains.md).

Capabilities are claimed in `tests/manifests/rsbuild-vue-spa.ts`, one at a time,
each after its contract passed here.
