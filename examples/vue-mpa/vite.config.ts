import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import zintl from "zintljs/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
    vue(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        about: resolve(__dirname, "about.html"),
      },
    },
  },
});
