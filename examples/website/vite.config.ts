import { defineConfig } from "vite-plus";
import { zintl } from "@zintl/vite";

export default defineConfig({
  // logLevel: "silent",
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es"],
      outputDir: "./src/locales",
      catalogFormat: "i18n.json",
      similarityThreshold: 0.01,
      // debug: true,
    }),
  ],
});
