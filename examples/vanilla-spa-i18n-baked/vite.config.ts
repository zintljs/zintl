import { defineConfig } from "vite-plus";
import { zintl } from "zintl";

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
});
