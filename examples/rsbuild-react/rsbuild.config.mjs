import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import zintl from "zintljs/rsbuild";

/**
 * React on Rspack — the first *framework* app on a non-Rollup host.
 *
 * `examples/rsbuild-spa` established that Zintl builds and hot-updates through
 * Rspack, but it is vanilla, so every framework-shaped question on this host had
 * to be answered by inference from the Vite examples (see `027-leak-ledger.md`,
 * the vanilla-only hypothesis). This exists to make those questions measurable.
 *
 * Deliberately mirrors `examples/rsbuild-spa`'s configuration, so a difference
 * between the two is attributable to React rather than to the host — the same
 * discipline that file applies against `examples/vanilla-spa-basic`. The only
 * additions are `pluginReact()` and the React dependencies.
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
  source: { entry: { index: "./src/main.tsx" } },
  html: { template: "./index.html" },
});
