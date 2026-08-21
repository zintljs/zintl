import { defineConfig } from "vite-plus";
import zintl from "zintljs/vite";

/**
 * No framework plugin, and that is not an omission.
 *
 * Lit is a library rather than a compiler: a component is an ordinary module
 * exporting a class, and `create-vite`'s lit-ts template ships no plugin either.
 * Zintl detects Lit from the dependency alone, because there is no plugin name
 * to match — see `detectFrameworks`.
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
