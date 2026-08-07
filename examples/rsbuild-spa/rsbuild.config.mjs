import { defineConfig } from "@rsbuild/core";
import zintl from "zintljs/rsbuild";

/**
 * The proposal 026 falsification target.
 *
 * Deliberately as close to `examples/vanilla-spa-basic` as the host allows —
 * the point is an apples-to-apples application, not a configuration tuned until
 * the problems go away. Where this file differs from that example's
 * `vite.config.ts`, the difference is a finding.
 */
export default defineConfig({
  plugins: [
    ...zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      outputDir: "./src/i18n",
      catalogFormat: "translations.json",
      similarityThreshold: 0.01,
      assetsTarget: ["txt"],
    }),
  ],
  source: { entry: { index: "./src/main.ts" } },
  html: { template: "./index.html" },
});
