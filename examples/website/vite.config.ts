import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import zintl from "zintljs/vite";
import { searchIndex } from "./build/search-index";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      // The docs tree in `src/nav.ts` is data, and its titles are prose.
      // `obj:field` is deliberately not a default target, so the object is
      // named instead — which leaves `slug` and `id` beside it untouched.
      additionalTargets: ["obj:nav:title"],
    }),
    vue(),
    // Reads the same `.md` files the pages render — the authored artifacts
    // for the translated locales — so a search result cannot describe a page
    // that does not say that.
    searchIndex({ sourceLocale: "en", locales: ["en", "ar", "es", "zh"] }),
  ],
});
