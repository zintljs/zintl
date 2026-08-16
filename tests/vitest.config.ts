import { defineConfig } from "vite-plus/test/config";
import { configDefaults } from "vite-plus/test/config";
// import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  test: {
    globalSetup: ["./tests/setup.ts"],
    include: ["tests/**/*.{spec,test}.ts"],
    exclude: configDefaults.exclude.filter((x) => !x.includes("tests")),
    testTimeout: 45000,
    /**
     * No retries, deliberately.
     *
     * A retry converts a flake into a green run, which means the suite reports
     * "passing" for a codebase that intermittently does the wrong thing. Every
     * flake traced so far was a real defect — an assertion that could not retry,
     * or contention on a shared example directory — and each was found only
     * because someone read past the checkmark to the `(retry x1)` beside it.
     *
     * If a test needs a retry to pass, that is a bug report, not a hiccup.
     */
    retry: 0,
    /**
     * Contract output is only worth reading when something failed, so only a
     * failing test prints it.
     *
     * These projects are real apps driven through real dev servers, and the
     * servers run **in-process**: every `start building…`, every optimizer
     * notice, every `Server started at…` from an SSR example's own `server.js`
     * is written to the worker's stdout and re-emitted by Vitest under a
     * `stdout | <file> > <test>` heading, attributed to whichever test happened
     * to be running. On a green run that is pure noise, and it is not free —
     * four workers writing synchronously to a pipe, inside a 45s budget with
     * 15s reserved for diagnosis.
     *
     * `"passed-only"` is the whole point over `true`: **nothing is silenced at
     * the source.** The servers keep logging, `LabConsole` keeps capturing the
     * browser's console, `describeStall()` keeps printing its diagnosis — and a
     * failing test still shows everything it always did. This changes only
     * whether a *passing* test's output reaches the terminal.
     *
     * Deliberately here rather than in the harness: silencing a server through
     * its own config also silences the channels the harness listens on, which
     * is how forcing Rsbuild's `logLevel` to `"error"` once took the browser's
     * HMR client down with it and made a whole class of failure look like
     * nothing had happened (see `rsbuild-dev-server.ts`).
     */
    silent: "passed-only",
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
