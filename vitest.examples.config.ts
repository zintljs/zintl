import { defineConfig } from "vite-plus/test/config";

export default defineConfig({
  test: {
    globalSetup: "./scripts/cleanup-test.ts",
    include: ["**/__tests__/examples/**.{test,spec}.ts"],
  },
});
