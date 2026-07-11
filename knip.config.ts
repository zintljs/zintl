import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: ["tests/playwright.config.ts", "tests/**/*.spec.ts"],
      ignoreBinaries: [
        "vpx", // vite-plus companion binary, ships with vite-plus package
        // "vpr",
      ],
      ignoreFiles: ["scripts/budget-reporter.ts", "vitest.examples.config.ts"],
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
      entry: ["src/index.ts", "src/runtime/*.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/extractor": {
      entry: "src/index.ts",
      project: ["src/**/*.ts"],
    },
    "packages/zintl": {
      entry: ["src/index.ts", "src/macro.ts", "src/vite.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/testing": {
      entry: "src/index.ts",
      project: ["src/**/*.ts"],
    },
  },
  ignoreDependencies: ["vite", "@vitest/coverage-v8"],
  exclude: ["catalog"],
  vitest: true,
  vite: true,
  pnpm: true,
};

export default config;
