import { defineConfig } from "@rsbuild/core";
import { pluginVue } from "@rsbuild/plugin-vue";
import zintl from "zintljs/rsbuild";

/**
 * `create-rsbuild`'s vue-ts starter, plus Zintl.
 *
 * The first Vue app Zintl has on a non-Rollup host. Until it existed the
 * support statement had to say Vue was *untested here rather than unsupported*
 * — nothing was known to break, and nothing had watched it either.
 *
 * The interesting question this app answers is loader ordering. Zintl declares
 * `enforce: "pre"`, so on Rspack its transform runs as a pre-loader and sees the
 * raw `.vue` file before `vue-loader` splits it into blocks — the same position
 * it holds on Vite by running before `@vitejs/plugin-vue`. That is the whole of
 * the framework integration; there is no Rspack-specific Vue code in Zintl.
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
      similarityThreshold: 0.01,
    }),
  ],
  source: { entry: { index: "./src/index.ts" } },
  html: { template: "./index.html" },
});
