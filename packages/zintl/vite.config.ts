import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/macro.ts", "src/vite.ts", "src/facets.ts"],
    dts: true,
  },
});
