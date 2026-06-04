import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { zintl } from "zintl";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
    }),
    react(),
  ],
});
