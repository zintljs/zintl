# `rsbuild-vanilla-spa`

`create-rsbuild`'s **vanilla-ts** starter with a client router, localized. The
routed counterpart of [`rsbuild-vanilla-basic`](../rsbuild-vanilla-basic).

```bash
pnpm dev      # rsbuild dev
pnpm build    # tsc && rsbuild build
pnpm preview  # rsbuild preview
```

## Why it exists

One dynamic import. `/about` is fetched on demand, so its strings live in a
boundary the entry never imports statically — and that is the only shape that
asks whether **catalog splitting follows the host's own chunking on Rspack**.
Every other Rspack example has a single entry boundary, which demonstrated
chunk alignment only for the trivial case.

Measured here: the About page ships as `dist/static/js/async/*.js`, its
translations resolve when the route is visited, and Arabic renders RTL on a page
that was never in the initial bundle. No `manualChunks`, no Rspack-specific code
in Zintl — the compiler emits one virtual module per chunk behind a dynamic
import and lets the host's splitter place it.

## Two things worth copying, and one worth knowing

**`innerHTML` is what makes a template literal translatable.** Look at
`src/pages/Home.ts`: the markup is assigned to `container.innerHTML` rather than
returned as a string. Extraction stitches _HTML_ out of template literals, and it
knows a literal is HTML from the sink it is written to. A bare
``return `<h1>…` `` is just a string as far as the extractor can tell, and is
left alone — silently, because there is nothing there to warn about. This is the
same rule on Vite; it is only easy to trip over when you are writing a router by
hand.

**The locale survives navigation** because `Router.navigate` carries `?lang`
across. Nothing about that is Zintl's doing — it is what any client router has to
do with a query parameter — but leaving it out makes the app look broken in a way
that reads like a Zintl bug.

**`server.historyApiFallback: true`** in `rsbuild.config.mjs` is the router's
requirement, not Zintl's: a deep link to `/about` has to reach the same document.

## Status

Supported for single-page apps in build and dev, like the other Rspack examples.
SSR and `multiplex` are not on this host — see
[proposal 030](../../docs/spec/proposals/030-rsbuild-what-remains.md).

Capabilities are claimed in `tests/manifests/rsbuild-vanilla-spa.ts`, one at a
time, each after its contract passed here.
