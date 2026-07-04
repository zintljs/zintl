import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
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
      ignoreFiles: ["src/**.d.ts"],
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
      entry: ["src/index.ts", "src/macro.ts"],
      project: ["src/**/*.ts"],
    },
  },
  ignoreBinaries: [
    "vpx", // vite-plus companion binary, ships with vite-plus package
    "vpr",
  ],
  ignoreDependencies: ["vite", "@vitest/coverage-v8"],
  exclude: ["catalog"],
  ignoreFiles: ["scripts/budget-reporter.ts", "vitest.examples.config.ts"],
  vitest: true,
  vite: true,
  pnpm: true,
};

export default config;
