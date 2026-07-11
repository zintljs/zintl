import { defineConfig } from "vite-plus";
import zintl from "zintl/vite";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
  ] as any[],
});
