import vinext from "vinext";
import { defineConfig } from "vite-plus";
import zintl from "zintljs/vite";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      catalogFormat: "[path].json",
    }),
    vinext(),
  ],
});
