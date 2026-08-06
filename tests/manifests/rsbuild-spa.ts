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
  /**
   * Build-time capabilities, plus the browser ones that do not involve hot
   * updates.
   *
   * `spa` became claimable once the dev-server driver seam existed, and it buys
   * the thing nothing else covered: whether an app Zintl built through Rspack
   * actually *runs* in a browser rather than merely producing plausible bytes.
   *
   * **Not `locale-switch`/`rtl`.** The store now keeps `<html lang>` honest on
   * any host (L-019), but the `locale-switch` contract also asserts `dir`, and
   * direction comes from the HTML projection — which reaches this host only
   * through an HTML transform Zintl does not yet have here. See the ledger for
   * what an attempt at that wiring turned up.
   *
   * **Not `hmr` or anything built on it.** Zintl emits no acceptance code on
   * this host (`rspackFacet`), because ZDB §7a makes dev support conditional on
   * two ordering guarantees not established here.
   */
  capabilities: ["build", "graph", "transform", "spa"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/main.ts",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: async (lab, locale) => {
      if (locale === "ar") await lab.page.click("button:has-text('العربية')");
      else if (locale === "en") await lab.page.click("button:has-text('English')");
      else if (locale === "es") await lab.page.click("button:has-text('Español')");
      else if (locale === "zh") await lab.page.click("button:has-text('中文')");
    },
  },
};
