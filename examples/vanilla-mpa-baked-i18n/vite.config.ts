import { defineConfig } from "vite-plus";
import zintl from "zintl/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      outputDir: "./src/i18n",
      catalogFormat: "translations/[locale].json",
      similarityThreshold: 0.01,
    }),
  ] as any[],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        about: resolve(__dirname, "about.html"),
      },
    },
  },
});
