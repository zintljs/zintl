import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import zintl from "zintl/vite";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
    vue(),
  ],
});
