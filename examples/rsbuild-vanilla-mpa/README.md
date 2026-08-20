# `rsbuild-vanilla-mpa`

Two documents, two entries, one shared header — the multi-page case on Rspack,
from `create-rsbuild`'s **vanilla-ts** starter.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # rsbuild dev
pnpm build    # tsc && rsbuild build
pnpm preview  # rsbuild preview
```

## Why it exists

`packages/zintl/src/hooks/html.ts` was written for more than one entry —
`declareHtmlEntriesHook` builds a map, `entriesFor` inverts an emitted filename
back to the template that produced it, and both warn when a document is
ambiguous. Until this app, all of that had only ever run against a single
`index`, so the code that picks _which_ template to project was exercised only
in the case where there is one.

It now runs against two, and the answer is that it works: `dist/index.html` and
`dist/about.html` each get their own `<title>`, their own `dir`, and their own
catalog chunks, and the projection picks the right template for each.

The Rsbuild-specific part is why this is not free. An Rsbuild template names no
scripts, so nothing in `index.html` says which module it loads — the association
comes out of `source.entry` and `html.template` in `rsbuild.config.mjs`, which is
[L-021](../../docs/spec/proposals/027-leak-ledger.md). With two entries, that
mapping has to be per-entry, and `html.template` is written here as a function of
`entryName` rather than a string.

## The shared boundary

`src/components/Header.ts` is imported by both pages and calls `zintl(locale)`
**itself**. An anchor is independent — it does not inherit from whichever page
mounted it — so the header's strings form one boundary shared by both entries
rather than being duplicated into each. The build shows it: nine catalog chunks,
three boundaries (home, about, header) × three non-source locales, and none for
`en`, because ghost mode never writes the source locale.

On Vite this case has its own example
([`examples/vanilla-mpa-shared`](../vanilla-mpa-shared)); here it is folded into
the one multi-page app rather than adding a second directory.

## This is not `multiplex`

Worth being explicit, because the words are close. **`multiplex`** means
per-locale HTML fan-out — `dist/{en,ar,es,zh}/index.html`, one document per
locale, locale baked at build time. It is Vite-only and **permanently** fenced
on this host ([L-022](../../docs/spec/proposals/027-leak-ledger.md)); combining
it with Rsbuild fails the build with a clear Zintl error rather than doing
nothing quietly.

What this app does instead is ordinary multi-page: two documents, and the locale
chosen at runtime through `?lang=`. Every anchor here is `zintl(lang)` with a
**variable**, so multiplex auto-detection — which looks for a sovereign
`zintl()` / `zintl("*")` — never fires.
[`examples/vanilla-mpa-baked-i18n`](../vanilla-mpa-baked-i18n) is the fan-out
case, and it stops at Vite.

## Status

Supported for build and dev, like the other Rspack examples. Capabilities are
claimed in `tests/manifests/rsbuild-vanilla-mpa.ts`, one at a time, each after
its contract passed here.
