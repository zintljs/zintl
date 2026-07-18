import { defineConfig } from "vite-plus/test/config";
import { configDefaults } from "vite-plus/test/config";
// import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  test: {
    globalSetup: ["./tests/setup.ts"],
    include: ["tests/**/*.{spec,test}.ts"],
    exclude: configDefaults.exclude.filter((x) => !x.includes("tests")),
    testTimeout: 45000,
    retry: 1,
    maxWorkers: 1,
    // browser: {
    //   enabled: true,
    //   headless: true,
    //   provider: playwright(),
    //   instances: [{ browser: "chromium" }],
    // },
  },
});
