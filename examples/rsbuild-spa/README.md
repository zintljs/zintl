# `rsbuild-spa`

Zintl on a bundler that is not Vite. A vanilla SPA — four locales, a counter, a
locale switcher, a localized `.txt` asset — built and served by
[Rsbuild](https://rsbuild.dev) instead of Vite.

It deliberately mirrors [`examples/vanilla-spa-basic`](../vanilla-spa-basic),
so any difference in output is attributable to the **host** rather than to the
app.

```bash
pnpm dev      # rsbuild dev     — with hot updates
pnpm build    # tsc && rsbuild build
pnpm preview  # rsbuild preview
```

## What this demonstrates

**Nothing about the app is Rsbuild-specific.** The source is plain string
literals, `zintl(locale)` is the trust anchor, and the catalogs under `src/i18n/`
have the same shape as every Vite example's. Only `rsbuild.config.mjs` differs,
and only in importing `zintljs/rsbuild` rather than `zintljs/vite`.

The claim that survived the port intact is the central one: **catalogs stay
aligned to the bundler's own code splitting.** The build emits one async chunk
per non-source locale, each carrying only its own catalog, with no
Rspack-specific chunking code anywhere in Zintl — the compiler emits one virtual
module per chunk behind a dynamic import and lets the host's splitter place it.
Ghost mode holds too: there is no `en` chunk, because the source locale is never
written to disk.

**The document follows the locale as well.** Switching to Arabic sets
`<html lang="ar" dir="rtl">` and swaps `<title>` — through
`src/i18n/index.html.translations.json`, the same HTML catalog every Vite
example uses. Two things had to exist for that: Rsbuild's `api.modifyHTML`,
which is the host-neutral counterpart of Vite's `transformIndexHtml`; and a way
to tell Zintl which script this document loads, since an Rsbuild template names
none — the entry is injected from `source.entry` at build time, so the
association lives in `rsbuild.config.mjs` where only the host can see it.

## What is not supported

Stated plainly, because an example that looks complete while quietly doing less
is worse than one with a known gap.

| Gap             | Why                                                                                                                                                     |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`multiplex`** | Per-locale HTML fan-out is Vite-only and **not planned** here. Combining it with this host fails the build immediately with a clear Zintl error (L-022) |
| **Preloading**  | The projection injects no `<link rel="modulepreload">` here. Catalogs still load, one network round-trip later than they would on Vite                  |
| **SSR**         | Unbuilt and unexamined                                                                                                                                  |

**Hot updates work as of [proposal 029](../../../docs/spec/proposals/029-rsbuild-hmr-facet-seam.md).**
`pnpm dev` applies a string edit without reloading the page, on the source locale
and on lazily-loaded ones alike. Two things made that possible, and the second is
the interesting one:

- Rspack supplies both guarantees Zintl's delivery bus requires, from its own
  machinery rather than anything Zintl invents — `Watching.startTime` is the
  monotonic per-event sequence, `compiler.inputFileSystem` is the read scoped to
  that event.
- Rspack rebuilds whatever **its own dependency graph** says is stale, and asks
  Zintl nothing. So the generated catalogs are not invalidated by hand here; they
  _declare what they are derived from_, and Rspack rebuilds them in the same
  compilation as the edit. Vite works the opposite way round — it asks for a
  module list — which is why the two hosts share every decision and none of the
  application of it.

## The localized asset

`src/about.txt` and its copies under `src/i18n/src/` are not decoration. Rspack
types modules by **file extension**, decided before any plugin speaks, where
Rollup and Vite type them by whoever loaded the module. So a `.txt` that Zintl
loaded as JavaScript was classified as an asset and base64-encoded into a
`data:` URI — the catalog shipped a URI where the translated text belonged, with
a green build and green contracts.

Fixed by giving generated modules an extension-free virtual identity, and the
contract suite now asserts the rendered Arabic in a real browser. Recorded as
**L-009** in the [026 leak ledger](../../../docs/spec/proposals/026-leak-ledger.md).

## Status

Promoted from a test fixture to an example by
[proposal 027](../../../docs/spec/proposals/027-completing-the-rsbuild-target.md),
and from an example to a supported target by
[proposal 029](../../../docs/spec/proposals/029-rsbuild-hmr-facet-seam.md), which
built the HMR facet seam that [028
§6](../../../docs/spec/proposals/028-rsbuild-support-status.md) named as the
structural blocker.

This app claims eleven of the contract layer's capabilities, including `hmr` and
`hmr-stress` — every one added only after its contract passed against this host,
which is why the suite carries no skipped tests.

Two are still unclaimed and neither is a gap in the gaps table above, because
neither is a defect in this integration. `memory` needs `memory-leak`'s twenty
sequential edits to fit inside 45s, and every edit here costs two compilations —
Zintl's own catalog write is, necessarily, a declared dependency of the generated
modules. `chaos` needs `chaos-boundary` to stop assuming the renamed file and the
heading file are the same one, which they cannot be when the entry is named in
`rsbuild.config.mjs`. Both are written up in `tests/manifests/rsbuild-spa.ts`.
