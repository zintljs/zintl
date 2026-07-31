import { defineConfig } from "vite-plus";
import zintl from "zintljs/vite";

export default defineConfig({
  // logLevel: "silent",
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es"],
      outputDir: "./src/locales",
      // catalogFormat: "[locale].json",
      similarityThreshold: 0.01,
      // debug: true,
    }),
  ],
});
