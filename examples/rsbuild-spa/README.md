# `rsbuild-spa`

Zintl on a bundler that is not Vite. A vanilla SPA — four locales, a counter, a
locale switcher, a localized `.txt` asset — built and served by
[Rsbuild](https://rsbuild.dev) instead of Vite.

It deliberately mirrors [`examples/vanilla-spa-basic`](../vanilla-spa-basic),
so any difference in output is attributable to the **host** rather than to the
app.

```bash
pnpm dev      # rsbuild dev     — see the gap below
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

## What is not supported yet

Stated plainly, because an example that looks complete while quietly doing less
is worse than one with a known gap.

| Gap                                  | Why                                                                                                                                                                                                                                      |
| :----------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hot updates**                      | `pnpm dev` serves and rebuilds, but Zintl emits no hot-update acceptance code on this host. Editing a string needs a manual reload. See below                                                                                            |
| **`<html dir>`**                     | `lang` follows the locale; `dir` does not. Direction is read from HTML catalogs, and on this host no HTML document reaches a boundary — an Rsbuild template carries no `<script src>`, because the entry is injected from `source.entry` |
| **`<title>` / `<meta description>`** | The HTML projection reaches a page through `transformIndexHtml`, which is Vite's hook and is dropped on every other host                                                                                                                 |
| **SSR, MPA**                         | Untouched and unexamined here                                                                                                                                                                                                            |

**Why hot updates are withheld rather than approximated.** Rspack uses
`module.hot` where Vite uses `import.meta.hot`, so the inherited snippet is
simply wrong — but emitting the `module.hot` equivalent would be worse. Zintl's
delivery bus requires a monotonic non-repeating per-event sequence and a `read()`
scoped to that event, and neither has been established on this host. Shipping
without them would ship back the ordering defect the delivery bus exists to
remove. A `dev` script that starts a server and silently never updates is the
failure mode worth avoiding; a stated gap is not.

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
[proposal 027](../../../docs/spec/proposals/027-completing-the-rsbuild-target.md).
Being an example is **not** a promise of support — that is a separate decision,
and the remaining work is named above rather than guessed at.
