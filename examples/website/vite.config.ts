import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import zintl from "zintljs/vite";
import { searchIndex } from "./build/search-index";

export default defineConfig({
  /**
   * The site is published as a GitHub Pages *project* site, which serves it
   * under the repository name rather than at a domain root.
   *
   * Set unconditionally rather than only for the production build, so that dev
   * and preview run under the same base the deployment does. A base path breaks
   * things that look fine at `/` — this one broke locale detection — and the
   * place to find that is here rather than after a deploy.
   */
  base: "/zintl/",
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      pendingLocales: ["fr", "de", "ja", "ko", "it", "pt", "ru", "tr", "fa", "he", "ur"],
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
