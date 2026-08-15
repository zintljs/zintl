import { defineConfig } from "@rsbuild/core";
import zintl from "zintljs/rsbuild";

/**
 * `create-rsbuild`'s vanilla-ts starter with a client router, plus Zintl.
 *
 * The one thing this example exists to exercise is **lazy catalogs on Rspack**:
 * `/about` arrives through `await import()`, so its boundary is emitted behind
 * the same dynamic import the page is, rather than being folded into the entry.
 * Every other Rspack example has a single entry boundary, which left chunk
 * alignment on this host demonstrated only for the trivial case.
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
