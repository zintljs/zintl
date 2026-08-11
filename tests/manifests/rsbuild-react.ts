import {
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
  outputDir: "./src/i18n",
  catalogFormat: "translations.json",
  similarityThreshold: 0.01,
};

/**
 * React on Rspack — a *framework* app on a non-Rollup host.
 *
 * Every other Rspack project here is vanilla, which meant every framework-shaped
 * question on this host was answered by inference from the Vite examples. One
 * such inference — the vanilla-only hypothesis, L-030 — was refuted the first
 * time it was measured against this app, so the inferences were not reliable.
 *
 * Claims are deliberately narrow to start with, and grow the way `rsbuild-spa`'s
 * did: one at a time, each after its contract passes here. That is what keeps
 * the suite free of skipped tests.
 */
export const rsbuildReact: ProjectManifest = {
  name: "rsbuild-react",
  source: copiedExampleSource("rsbuild-react"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Build-time capabilities plus the non-HMR browser ones, matching what
   * `rsbuild-spa` could claim before its HMR work.
   *
   * **Not `hmr`.** Measured here, four consecutive edits: 4/4 blank headings, no
   * page reload — the L-030 empty-render defect, which this example is what
   * proved is *not* confined to vanilla entries. Claiming `hmr` would be
   * claiming something demonstrably false on this project, so it waits for that
   * defect rather than the other way round.
   *
   * **Not `assets`.** This app localizes no asset; `rsbuild-spa` covers that
   * path on this host.
   */
  capabilities: ["build", "graph", "transform", "spa", "boundary-graph", "locale-switch", "rtl"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    /** The heading lives in the component, not the entry — see the example's README. */
    headingFile: "src/App.tsx",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/?lang=${locale}`);
    },
    /** As on `rsbuild-spa`: Rspack emits catalogs as hashed async chunks. */
    isCatalogRequest: (url) => url.includes("/static/js/async/"),
    switchLocale: async (lab, locale) => {
      if (locale === "ar") await lab.page.click("button:has-text('العربية')");
      else if (locale === "en") await lab.page.click("button:has-text('English')");
      else if (locale === "es") await lab.page.click("button:has-text('Español')");
      else if (locale === "zh") await lab.page.click("button:has-text('中文')");
    },
  },
};
