import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import zintl from "zintljs/vite";

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
  ],
});
