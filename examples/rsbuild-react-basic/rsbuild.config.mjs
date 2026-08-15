import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import zintl from "zintljs/rsbuild";

/**
 * `create-rsbuild`'s react-ts starter, plus Zintl.
 *
 * Deliberately mirrors `examples/rsbuild-vanilla-basic`'s configuration, so a
 * difference between the two is attributable to **React** rather than to the
 * host — the same discipline that example applies against
 * `examples/vanilla-spa-basic`. The only additions are `pluginReact()` and the
 * React dependencies.
 *
 * `html.template` and the explicit `source.entry` are the two lines the template
 * does not scaffold; see `examples/rsbuild-vanilla-basic/rsbuild.config.mjs` for
 * why both are load-bearing.
 *
 * No `assetsTarget`: this app localizes no asset, and
 * `examples/rsbuild-vanilla-basic` covers that path on this host.
 */
export default defineConfig({
  plugins: [
    pluginReact(),
    ...zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      outputDir: "./src/i18n",
      catalogFormat: "translations.json",
      similarityThreshold: 0.01,
    }),
  ],
  source: { entry: { index: "./src/index.tsx" } },
  html: { template: "./index.html" },
});
