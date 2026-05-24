import { defineConfig } from "vite-plus";
import { zintl } from "zintl";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
  ] as any[],
});
