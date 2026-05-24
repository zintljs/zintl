import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    "examples/**": {
      entry: ["src/{about,main,entry-client,entry-server}.ts"],
      project: ["src/**/*.ts"],
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
  ],
  ignoreFiles: ["scripts/budget-reporter.ts"],
  vitest: true,
  vite: true,
};

export default config;
