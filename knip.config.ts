import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: ["tests/vitest.config.ts", "tests/setup.ts", "tests/**/*.spec.ts"],
      ignoreBinaries: [
        "vpx", // vite-plus companion binary, ships with vite-plus package
        // "vpr",
      ],
      ignoreFiles: ["scripts/budget-reporter.ts"],
      /**
       * A materialized project, not importable source. `dirSource()` copies the
       * whole directory and a build tool runs it from there, so nothing in the
       * repo imports these files and knip is right that they have no importer —
       * it is the wrong question for this directory.
       */
      ignore: ["tests/fixtures/rsbuild-spa/**"],
    },
    "examples/svelte-*": {
      sveltekit: true,
    },
    "examples/vinext-*": {
      next: true,
      // ignore: [".vinext/**"],
      ignoreDependencies: ["ipaddr.js"],
    },
    "examples/**": {
      entry: ["src/{about,main,entry-client,entry-server,index}.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx}"],
    },
    "examples/vue-*": {
      entry: ["src/{about,main,entry-client,entry-server}.ts"],
      vue: true,
    },
    "packages/compiler": {
      entry: ["src/index.ts", "src/runtime/*.ts", "src/facet/index.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/extractor": {
      entry: "src/index.ts",
      project: ["src/**/*.ts"],
    },
    "packages/zintl": {
      entry: ["src/index.ts", "src/macro.ts", "src/vite.ts", "src/rsbuild.ts", "src/facets.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/testing": {
      entry: "src/index.ts",
      project: ["src/**/*.ts"],
    },
  },
  // `zintljs` is never imported at the root. It is linked here so that inline
  // contract fixtures materialized under `.tmp/fixtures/` can resolve the bare
  // `zintljs` / `zintljs/vite` specifiers by walking up to the root
  // node_modules — a runtime resolution need knip cannot observe statically.
  //
  // `@rsbuild/core` is here for the same reason and no other: the proposal 026
  // fixture's `rsbuild.config.mjs` imports it at materialization time. The
  // driver that drives it declares its own copy in `packages/testing`.
  ignoreDependencies: ["vite", "@vitest/coverage-v8", "zintljs", "@rsbuild/core"],
  exclude: ["catalog"],
  vitest: true,
  vite: true,
  pnpm: true,
};

export default config;
