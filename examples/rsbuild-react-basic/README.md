# `rsbuild-react-basic`

`create-rsbuild`'s **react-ts** starter, localized. React on Rspack — the first
**framework** app Zintl had on a non-Rollup host.

```bash
pnpm dev      # rsbuild dev     — string edits apply in place, no reload
pnpm build    # tsc && rsbuild build
pnpm preview  # rsbuild preview
```

Read it as "I ran `pnpm create rsbuild`, then added localization". The page, the
CSS and the `#root` mount point are the template's; what was added is the
localization layer — the switcher in `src/App.tsx`, the `?lang=` query parameter,
`await zintl(lang)` in `src/index.tsx`, the catalogs under `src/i18n/`, and the
`index.html` template that Zintl needs in order to localize `<title>` and
`<html dir>`.

At the Zintl level it deliberately mirrors
[`examples/rsbuild-vanilla-basic`](../rsbuild-vanilla-basic)'s configuration, so
a difference between the two is attributable to **React** rather than to the
host — the same discipline that example applies against
[`examples/vanilla-spa-basic`](../vanilla-spa-basic). The only additions are
`pluginReact()` and the React dependencies.

> Named `rsbuild-react` until the `rsbuild-<framework>-<pattern>` convention took
> hold. Proposals 026–030 and both leak ledgers still use the old name on
> purpose: they record what was measured when.

## Why it exists

`rsbuild-vanilla-basic` established that Zintl builds and picks up dev edits through
Rspack, but it is vanilla — and vanilla turned out to be the case that _cannot_
apply an edit in place, so it reloads instead ([L-035](../../docs/spec/proposals/027-leak-ledger.md)).
This app is the one that hot-updates: measured, four consecutive edits apply with
no page reload. That left every framework-shaped question on this host answerable
only by inference from the Vite examples until it existed — and one such inference
turned out to be wrong the moment it was tested here.

The specific question was the **vanilla-only hypothesis**
([`027-leak-ledger.md`](../../docs/spec/proposals/027-leak-ledger.md), L-030): the empty-render defect
was thought to need a non-reactive entry, because a vanilla repaint re-runs `zintl()` and rebuilds the
store from a stale binding, whereas a framework repaint is an ordinary render that merely re-reads the
catalog. That reasoning was sound and the conclusion was still false — measured here, four consecutive
edits rendered blank. React was affected too, and that finding is what led to L-032.

Both are long fixed. Today this app hot-updates: an edit to a string in `App.tsx` applies in place,
with no page reload. It is the project that proves the framework path on this host, which is why the
support statement names React and vanilla and stops there.

## What it demonstrates beyond that

**Chunk-aligned catalogs survive React on Rspack.** The build emits one async
chunk per non-source locale and none for `en` — ghost mode holds, with no
Rspack-specific and no React-specific chunking code anywhere in Zintl:

```
dist/static/js/async/679.js   ← ar
dist/static/js/async/405.js   ← es
dist/static/js/async/660.js   ← zh
```

**Nothing about the app is Rspack-specific.** The source is ordinary React with
plain string literals; `zintl(locale)` is the trust anchor. Only
`rsbuild.config.mjs` differs from a Vite React app, and only in which plugin it
imports.

## Status

Supported, alongside `rsbuild-vanilla-basic`, for single-page apps in build and dev — see
[proposal 030](../../docs/spec/proposals/030-rsbuild-what-remains.md) for what that promise covers and
what it deliberately excludes.

It claims nine of the contract layer's capabilities, each added only after its contract passed here.
Two are deliberately absent and both are measured rather than assumed. `memory` passes ten runs in ten
**in isolation** and fails three in three inside the full suite, where twenty sequential edits compete
with three other workers — a capability is a claim about the suite, so it is not claimed. `chaos` fails
because a boundary file created and imported in the same watch cycle never reaches the hot-update hook;
the rename config it would need is already in `tests/manifests/rsbuild-react-basic.ts`, unclaimed.
