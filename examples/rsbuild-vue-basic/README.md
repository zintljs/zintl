# `rsbuild-vue-basic`

`create-rsbuild`'s **vue-ts** starter, localized. Vue 3 on Rspack.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # rsbuild dev     — string edits apply, via a page reload (see below)
pnpm build    # rsbuild build
pnpm preview  # rsbuild preview
pnpm check    # vue-tsc
```

Read it as "I ran `pnpm create rsbuild`, then added localization". The page, the
scoped styles and the `#root` mount point are the template's; what was added is
the localization layer — `src/components/LocaleSwitcher.vue`, the `?lang=` query
parameter, `await zintl(lang)` in `src/index.ts`, the catalogs under `zintl/`,
and the `index.html` template Zintl needs in order to localize `<title>` and
`<html dir>`.

## Why it exists

Vue on Rspack was broken until the fix this example forced, and it was broken in
the worst available way: it **built green and shipped the source locale**.
Extraction, catalog scaffolding, `verifyIntegrity`, chunk alignment and the HTML
projection were all correct — only the code generation was missing, so the page
rendered English under a Spanish `<title>`.

The cause was one skip in `hooks/transform.ts`. `vue-loader` compiles each block
of an SFC through a separate request (`App.vue?vue&type=script&…`), and Zintl
skipped every id carrying `?vue` — correctly on Vite, where that id names a
virtual module holding one block, and wrongly here, where `vue-loader`'s pitcher
rewrites it into a `-!` request that **re-reads the whole file**. Zintl was
transforming the parent request, which is discarded, and skipping the block
requests, which become the code.

Whether a block request carries the whole file or just the block is a fact about
the bundler, so the bundler facet now declares it
(`sfcBlockRequestsCarryWholeFile`) and `hooks/transform.ts` asks instead of
assuming. See [L-051](../../docs/spec/proposals/027-leak-ledger.md).

## `<script setup>` is required, on both hosts

Not an Rspack limitation — measured on Vite too. A component written with a
plain `<script>` and a separate `<template>` compiles its template into its own
module, where template expressions resolve against the component instance. The
`_t()` calls Zintl injects are in the script's scope, not on the instance, so the
render fails with `_ctx._t is not a function`.

`<script setup>` compiles the template inline into the setup function, so the
injected imports are in scope, and that is what every Vue example in this
repository uses. If you are localizing an Options-API component, convert it to
`<script setup>` first.

## What this demonstrates

**Nothing about the app is Rspack-specific.** Plain string literals in the
template, `zintl(locale)` as the trust anchor, catalogs under `zintl/` with the
same shape as every Vite example's. Only `rsbuild.config.mjs` differs from a Vite
Vue app, and only in which plugin it imports.

The build emits one async chunk per non-source locale and none for `en` — ghost
mode holds, with no Rspack-specific and no Vue-specific chunking code anywhere in
Zintl.

## Dev edits reload rather than repaint

Deliberate, and the same trade the vanilla and Svelte examples make. On Rspack
Zintl only emits `import.meta.webpackHot.accept()` when the framework declares
client reactivity, and today only React does — so a Vue edit declines the update,
it bubbles, and the page reloads. The text is correct either way and `<html dir>`
survives.

## Status

Supported for single-page apps in build and dev, alongside the other Rspack
examples. SSR and `multiplex` are not on this host — see
[proposal 030](../../docs/spec/proposals/030-rsbuild-what-remains.md).

Capabilities are claimed in `tests/manifests/rsbuild-vue-basic.ts`, one at a
time, each after its contract passed here.
