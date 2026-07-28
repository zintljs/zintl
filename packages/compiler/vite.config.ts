import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: ["src/index.ts"],
      dts: true,
    },
    {
      entry: [
        "src/runtime/store-core.ts",
        "src/runtime/store-client.ts",
        "src/runtime/store-server.ts",
        "src/runtime/store.ts",
        "src/runtime/resolver.ts",
        "src/runtime/registry.ts",
        "src/runtime/internal.ts",
      ],
      outDir: "dist/runtime",
      dts: true,
      deps: {
        neverBundle: [
          "./store-core.js",
          "./store-client.js",
          "./store-server.js",
          "./store.js",
          "./resolver.js",
          "./registry.js",
          "node:async_hooks",
        ],
      },
    },
    {
      entry: ["src/facet/index.ts"],
      dts: true,
      outDir: "dist/facet",
    },
  ],
});
