import { dirSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
  outputDir: "./src/i18n",
  catalogFormat: "translations.json",
  similarityThreshold: 0.01,
  assetsTarget: ["txt"],
};

/**
 * The proposal 026 falsification target — Zintl under Rsbuild.
 *
 * **Capabilities are the scope control here, and they are the whole mechanism.**
 * Contract matching is a positive-only subset test (`runner.ts`), so claiming
 * exactly `build`, `graph` and `transform` selects the four project contracts
 * and nothing else. The 17 dev-server contracts require `spa`/`ssr`/`hmr`,
 * which this never claims, so they skip it without a single contract edit and
 * without any `excludes` mechanism existing.
 *
 * That answers §9 Q1 in the negative, which is the useful direction: the
 * capability model did **not** need a `bundler:*` dimension to express "run only
 * the build-time contracts against this host". Adding one would have answered
 * the question by assumption.
 *
 * Scope is ZDB §7a Tier 1 deliberately. Tier 2 needs a monotonic per-event
 * sequence and a `read()` scoped to that event, neither of which has been shown
 * to exist on this host — and shipping dev support without them would ship back
 * the ordering defect ZDB exists to remove.
 */
export const rsbuildSpa: ProjectManifest = {
  name: "rsbuild-spa",
  source: dirSource("tests/fixtures/rsbuild-spa"),
  driver: "rsbuild",
  zintlOptions,
  capabilities: ["build", "graph", "transform"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/main.ts",
    navigateHome: async () => {
      throw new Error(
        "rsbuild-spa is a build-only (Tier 1) target and claims no browser capabilities; " +
          "a contract reaching navigateHome means capability scoping regressed.",
      );
    },
  },
};
