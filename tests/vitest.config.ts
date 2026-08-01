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
    /**
     * Contracts mutate their project, and several target the same file of the
     * same example. This is only safe because manifests use
     * `copiedExampleSource`, which gives each worker a private copy — against
     * the shared `examples/` tree, 4 workers produced 31 failures out of 72 and
     * corrupted the working tree. Measured: 338s serial → 124s at 4 workers.
     */
    maxWorkers: 4,
    env: {
      /**
       * Declares that tests share a machine with sibling workers, so wall-clock
       * budgets must be read as "not pathologically slow" rather than as a
       * measurement. `vpr bench` is the real performance instrument.
       */
      ZINTL_PARALLEL: "1",
    },
    // browser: {
    //   enabled: true,
    //   headless: true,
    //   provider: playwright(),
    //   instances: [{ browser: "chromium" }],
    // },
  },
});
