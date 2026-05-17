import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    "examples/**": {
      entry: ["index.html", "src/main.ts", "src/index.ts", "src/about.ts"],
      project: ["src/**/*.ts", "index.html"],
    },
    "packages/compiler": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts", "scratch/**/*.ts"],
    },
    "packages/extractor": {
      entry: "src/index.ts",
      project: ["src/**/*.ts"],
    },
    "packages/runtime": {
      entry: ["src/index.ts", "src/internal.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/vite": {
      entry: "src/index.ts",
      project: ["src/**/*.ts"],
    },
  },
  // ignoreDependencies: ["@vitest/ui"],
  ignoreBinaries: [
    "vpx", // vite-plus companion binary, ships with vite-plus package
  ],
  ignoreFiles: ["scripts/budget-reporter.ts"],
  vitest: true,
  vite: true,
};

export default config;
