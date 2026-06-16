import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./scripts/cleanup-test.ts",
    include: ["**/__tests__/examples/**.{test,spec}.ts"],
  },
});
