---
"zintljs": minor
"@zintljs/compiler": patch
---

Rsbuild is a supported target.

`zintljs/rsbuild` now carries a promise rather than a disclaimer: single-page applications, in
production builds and in `rsbuild dev`, with React and vanilla JavaScript — chunk-aligned catalogs,
ghost mode, localized assets, per-locale `<html lang>`/`dir`, and hot updates. Vue and Svelte are
untested on this host rather than unsupported. SSR and per-locale HTML fan-out (`multiplex`) are
Vite-only, and combining `multiplex` with Rsbuild fails your build with a clear error rather than
doing nothing quietly.

Two fixes made the difference, and both were latent rather than new.

The hot-update hook Zintl registers on Rspack **was never actually being called**. unplugin gates its
`rspack` escape hatch on `meta.framework === "rspack"`, and its Rsbuild target sets `"rsbuild"`, so the
tap was dead code and Rsbuild had been hot-updating through the ordinary transform path all along. It
is now registered from the plugin's own Rsbuild block.

And the catalog flush was fire-and-forget — correct on Vite, where the browser's update comes from the
compiler's memory, and wrong on Rspack, where the generated modules declare the catalog files as
dependencies and Rspack builds them by reading those files. A compilation could therefore be built from
a catalog that had not been written yet. The flush is now awaited once per watch cycle, which made the
dev loop measurably _faster_: the late write had been forcing a second compilation per edit.
