import { defineConfig } from "@rsbuild/core";
import zintl from "zintljs/rsbuild";

/**
 * Two documents, two entries — the multi-page case on Rspack.
 *
 * This is the app that exercises `declareHtmlEntriesHook` and `entriesFor`
 * (`packages/zintl/src/hooks/html.ts`) with **more than one** entry. Both were
 * written for exactly this and, until this example, had only ever run against a
 * single `index`. An Rsbuild template names no scripts, so the document → entry
 * association is read out of `source.entry` and `html.template` below; with two
 * of each, the projection has to pick the right template per emitted document
 * rather than the only one there is (ledger L-021).
 *
 * **`multiplex` is not what this is.** Multiplex means per-locale HTML fan-out —
 * `dist/{en,ar,es,zh}/index.html` — and it is fenced on this host, permanently
 * (L-022). Here the locale is a runtime choice via `?lang=`, and each anchor is
 * `zintl(lang)` with a variable, so auto-detection never asks for multiplex.
 * `examples/vanilla-mpa-baked-i18n` is the fan-out case, and it is Vite-only.
 */
export default defineConfig({
  plugins: [
    ...zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      outputDir: "./src/i18n",
      catalogFormat: "translations.json",
      similarityThreshold: 0.01,
    }),
  ],
  source: {
    entry: {
      index: "./src/index.ts",
      about: "./src/about.ts",
    },
  },
  html: {
    template: ({ entryName }) => (entryName === "about" ? "./about.html" : "./index.html"),
  },
});
