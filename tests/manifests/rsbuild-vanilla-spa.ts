import {
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
  outputDir: "./src/locales",
  similarityThreshold: 0.01,
  /** No localizable assets — `rsbuild-vanilla-basic` covers that path on this host. */
  assetsTarget: [],
};

/**
 * A routed vanilla SPA on Rspack — the only Rspack project with a **lazy**
 * boundary.
 *
 * Every other one has a single entry boundary, so chunk alignment on this host
 * had only ever been demonstrated for the case where there is nothing to align.
 * Here `/about` arrives through `await import()`, its strings belong to a
 * boundary the entry never imports statically, and its catalog is emitted behind
 * the same dynamic import Rspack uses for the page.
 *
 * It also uses `outputDir: "./src/locales"` with the default per-locale catalog
 * format, which is a third layout across the Rspack projects — the other two use
 * `./src/i18n` with the shared `translations.json`, and `rsbuild-svelte-basic`
 * uses the default `zintl/`.
 */
export const rsbuildVanillaSpa: ProjectManifest = {
  name: "rsbuild-vanilla-spa",
  source: copiedExampleSource("rsbuild-vanilla-spa"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Claims grow one at a time, each after its contract passes here.
   *
   * **Not `hmr`, and now measured: 10 failures in 10**
   * (`node scripts/flake.js hmr.contract --runs=10`, 2026-08-15), in the same
   * batch where `rsbuild-vanilla-mpa`, `rsbuild-vanilla-basic` and
   * `rsbuild-react-basic` each failed 0 in 10. Deterministic, not intermittent.
   *
   * The failure is `expected '' to contain 'HMR works!'` — the empty render, the
   * same shape measured on `rsbuild-svelte-basic`. A vanilla app full-reloads on
   * an edit, and the reload beats the catalog write when the edited string lives
   * in a boundary the manager has to **fetch**. Here it does: the heading is on
   * the lazily-imported home route. `rsbuild-vanilla-basic` and
   * `rsbuild-vanilla-mpa` both reload too and both pass, because on those the
   * heading is in the entry's own boundary, which the manager inlines.
   *
   * So the dividing line on this host is not the framework and not the reload —
   * it is whether the edited string is inlined or fetched.
   *
   * `performance` is unclaimed on every Rspack project — `performance-size`
   * filters responses by Vite-shaped URLs. `chaos` and `memory` follow `hmr`.
   */
  capabilities: ["build", "graph", "transform", "spa", "boundary-graph", "locale-switch", "rtl"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Vanilla Rsbuild",
    /** The heading lives on the home page, not the entry. */
    headingFile: "src/pages/Home.ts",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/?lang=${locale}`);
    },
    /** As on the other Rspack projects: catalogs are hashed async chunks. */
    isCatalogRequest: (url) => url.includes("/static/js/async/"),
    switchLocale: async (lab, locale) => {
      if (locale === "ar") await lab.page.click("button:has-text('العربية')");
      else if (locale === "en") await lab.page.click("button:has-text('English')");
      else if (locale === "es") await lab.page.click("button:has-text('Español')");
      else if (locale === "zh") await lab.page.click("button:has-text('中文')");
    },
  },
};
