import { defineConfig } from "@rsbuild/core";
import zintl from "zintljs/rsbuild";

/**
 * `create-rsbuild`'s vanilla-ts starter, plus Zintl.
 *
 * Two lines of this file are not what the template scaffolds, and both are
 * required rather than stylistic:
 *
 * - **`html.template`.** The template leaves Rsbuild to generate its own
 *   document. With no source template there is nothing for Zintl's HTML
 *   projection to write into, so `modifyHtmlHook` warns and skips — no localized
 *   `<title>`, no per-locale `<html dir>`. Supplying `index.html` *is* part of
 *   adding localization.
 * - **`source.entry`.** Rsbuild infers `./src/index.ts` on its own, but naming
 *   it is what lets Zintl associate the document with a trust anchor: an Rsbuild
 *   template names no scripts, so `htmlEntries` is read from this config
 *   instead (ledger L-021).
 *
 * The file extension is `.mjs`, not the template's `.ts`, because
 * `composition.test.ts` identifies the host by `rsbuild.config.mjs` and
 * type-aware lint would want a `tsconfig.node.json` the template does not ship.
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
  source: { entry: { index: "./src/index.ts" } },
  html: { template: "./index.html" },
});
