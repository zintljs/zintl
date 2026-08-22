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
      // This entry must REFERENCE the core's types, never carry a copy. It
      // exports values whose types are declared in `dist/index.d.mts`, and the
      // presets import them under the package's own name so the emitted
      // declaration keeps that import instead of inlining what it points at.
      //
      // Left to bundle, the whole of `dist/index.d.mts` is folded in here and
      // every exported type gets a second declaration. Structural identity does
      // not save it: `IOManager` is a class with a private `root`, and TypeScript
      // compares classes with private members nominally, so the copies are
      // unrelated types. `ZintlFacet` from `@zintljs/compiler` then rejects a
      // facet from `@zintljs/compiler/facets` — the exact assignability failure
      // `src/facet/index.ts` documents, arriving through the build instead of
      // through a re-export.
      deps: { neverBundle: ["@zintljs/compiler"] },
    },
  ],
});
