# `rsbuild-react`

React on Rspack — the first **framework** app Zintl has on a non-Rollup host.

```bash
pnpm dev      # rsbuild dev
pnpm build    # tsc && rsbuild build
pnpm preview  # rsbuild preview
```

It deliberately mirrors [`examples/rsbuild-spa`](../rsbuild-spa)'s configuration,
so a difference between the two is attributable to **React** rather than to the
host — the same discipline `rsbuild-spa` applies against
[`examples/vanilla-spa-basic`](../vanilla-spa-basic). The only additions are
`pluginReact()` and the React dependencies.

## Why it exists

`rsbuild-spa` established that Zintl builds and picks up dev edits through
Rspack, but it is vanilla — and vanilla turned out to be the case that _cannot_
apply an edit in place, so it reloads instead ([L-035](../../docs/spec/proposals/027-leak-ledger.md)).
This app is the one that hot-updates: measured, four consecutive edits apply with
no page reload. That left every framework-shaped question on this host answerable
only by inference from the Vite examples until it existed — and one such inference
turned out to be wrong the moment it was tested here.

The specific question was the **vanilla-only hypothesis**
([`027-leak-ledger.md`](../../docs/spec/proposals/027-leak-ledger.md), L-030): the
empty-render defect was thought to need a non-reactive entry, because a vanilla
repaint re-runs `zintl()` and rebuilds the store from a stale binding, whereas a
framework repaint is an ordinary render that merely re-reads the catalog. That
reasoning was sound and the conclusion was still false. Measured here, on this
app, four consecutive edits: **4/4 blank, no page reload.** React is affected
too.

That is what this example is for. The heading lives in `App.tsx`, in a component,
precisely so a repaint is a React render rather than an entry re-execution — the
distinction the hypothesis turned on, now testable instead of arguable.

## What it demonstrates beyond that

**Chunk-aligned catalogs survive React on Rspack.** The build emits one async
chunk per non-source locale and none for `en` — ghost mode holds, with no
Rspack-specific and no React-specific chunking code anywhere in Zintl:

```
dist/static/js/async/37.js    ← ar
dist/static/js/async/515.js   ← es
dist/static/js/async/698.js   ← zh
```

**Nothing about the app is Rspack-specific.** The source is ordinary React with
plain string literals; `zintl(locale)` is the trust anchor. Only
`rsbuild.config.mjs` differs from a Vite React app, and only in which plugin it
imports.

## Status

New, and narrower than `rsbuild-spa` in what it claims. It exists to make
framework behaviour on this host **measurable**; the capabilities it claims in
`tests/manifests/` will grow the same way that example's did — one at a time,
each after its contract passes.
