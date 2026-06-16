import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig } from "vite-plus";
import { zintl } from "zintl";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
    vinext({
      appDir: fileURLToPath(new URL("src", import.meta.url)),
    }),
  ],
});
