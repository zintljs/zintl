import { defineConfig } from "@rsbuild/core";
import { pluginVue } from "@rsbuild/plugin-vue";
import zintl from "zintljs/rsbuild";

/**
 * Two documents, two Vue roots — the multi-page case with a framework on it.
 *
 * `examples/rsbuild-vanilla-mpa` established that Zintl's multi-entry HTML path
 * works on this host; this app asks whether a framework changes that answer, the
 * same way `rsbuild-react-basic` asked it of the single-entry case. Both pages
 * mount their own Vue app, and both import `SiteHeader.vue`, which anchors
 * itself — so the header's strings are one boundary shared by two entries.
 *
 * **This is not `multiplex`.** Both anchors take a variable, so auto-detection
 * never asks for the per-locale HTML fan-out that is fenced on this host
 * (L-022). The locale is a runtime choice via `?lang=`.
 *
 * `html.template` and the explicit per-entry `source.entry` are what let Zintl
 * associate each document with its trust anchor; an Rsbuild template names no
 * scripts, so that association lives here (L-021).
 */
export default defineConfig({
  plugins: [
    pluginVue(),
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
