import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { zintl } from "zintl";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
    svelte(),
  ],
});
