import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";
import zintl from "zintljs/vite";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
    solid(),
  ],
});
