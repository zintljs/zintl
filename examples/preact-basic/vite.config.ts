import { defineConfig } from "vite-plus";
import preact from "@preact/preset-vite";
import zintl from "zintljs/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
    preact(),
  ],
});
