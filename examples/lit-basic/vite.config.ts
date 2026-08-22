import { defineConfig } from "vite-plus";
import zintl from "zintljs/vite";

/**
 * The lit-ts template ships no `vite.config.ts` plugin list at all — Lit is a
 * library, not a compiler, so there is nothing to plug in. This file exists only
 * to add Zintl, which is also why `detectFrameworks` finds Lit from the
 * dependency rather than from a plugin name.
 */
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
  ],
});
