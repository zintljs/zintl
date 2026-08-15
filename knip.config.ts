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
    /**
     * The Rsbuild Svelte app needs the framework enabled, and the
     * `examples/svelte-*` pattern above does not match `rsbuild-svelte-*`.
     * Entries are `src/index.ts` (and `src/about.ts` on the MPAs), which is what
     * `create-rsbuild` scaffolds.
     *
     * Note what is *not* carried over from `examples/svelte-*`: `sveltekit`.
     * There is no SvelteKit here — `@rsbuild/plugin-svelte` is plain Svelte on
     * Rspack — and claiming the framework would have knip looking for routes
     * that do not exist.
     *
     * There is no `examples/rsbuild-vue-*` entry because there is no such
     * example: Vue on Rspack is blocked by L-051.
     */
    "examples/rsbuild-svelte-*": {
      entry: ["src/{about,index}.ts"],
      svelte: true,
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
  // `@rsbuild/core` is here for the same reason, and only that reason: an inline
  // fixture's `rsbuild.config.mjs` imports it at materialization time.
  // `examples/rsbuild-vanilla-basic` declares its own copy and does not rely on this — the
  // entry was briefly removed when that example was promoted, and had to come
  // back the moment a fixture needed the walk-up again.
  /**
   * `zintljs` and `@rsbuild/core` came off this list when `zintljs` declared
   * `@rsbuild/core` as an optional peer dependency (proposal 029) — knip
   * resolves both unaided now, and keeping them here would hide a real unused
   * dependency later.
   */
  ignoreDependencies: ["vite", "@vitest/coverage-v8"],
  exclude: ["catalog"],
  vitest: true,
  vite: true,
  pnpm: true,
};

export default config;
