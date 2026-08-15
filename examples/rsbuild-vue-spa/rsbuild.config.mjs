import { defineConfig } from "@rsbuild/core";
import { pluginVue } from "@rsbuild/plugin-vue";
import zintl from "zintljs/rsbuild";

/**
 * `create-rsbuild`'s vue-ts starter with `vue-router`, plus Zintl.
 *
 * The routed counterpart of `examples/rsbuild-vue-basic`, and the app that puts
 * a **lazy** boundary behind a framework on this host: `/about` is a
 * `() => import(...)` route, so its strings belong to a boundary the entry never
 * imports statically and Zintl emits their catalog behind the same dynamic
 * import Rspack uses for the component.
 *
 * `server.historyApiFallback` is the router's requirement, not Zintl's — a deep
 * link to `/about` has to reach the same document.
 *
 * `html.template` and the explicit `source.entry` are the two lines the template
 * does not scaffold; see `examples/rsbuild-vanilla-basic/rsbuild.config.mjs` for
 * why both are load-bearing.
 */
export default defineConfig({
  plugins: [
    pluginVue(),
    ...zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      outputDir: "./src/locales",
      similarityThreshold: 0.01,
    }),
  ],
  source: { entry: { index: "./src/index.ts" } },
  html: { template: "./index.html" },
  server: { historyApiFallback: true },
});
