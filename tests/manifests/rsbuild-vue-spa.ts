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
 * Vue with `vue-router` on Rspack — a **lazy** boundary behind a framework.
 *
 * `rsbuild-vanilla-spa` covers the lazy-catalog question with a hand-rolled
 * router; this covers it with the router a real Vue app uses, where the route
 * component is resolved asynchronously and rendered inside `<Suspense>`. The two
 * differ in more than spelling: a framework router mounts the lazy component
 * through the framework's own async boundary, so "did the catalog arrive before
 * the component rendered" is a different race.
 */
export const rsbuildVueSpa: ProjectManifest = {
  name: "rsbuild-vue-spa",
  source: copiedExampleSource("rsbuild-vue-spa"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Claims grow one at a time, each after its contract passes here.
   *
   * `hmr` is not claimed: only React declares client reactivity, so a Vue edit
   * on Rspack full-reloads, and the reload races the catalog write when the
   * edited string is in a fetched boundary rather than the entry's inlined one
   * — measured on `rsbuild-svelte-basic`. `performance` is unclaimed on every
   * Rspack project.
   */
  capabilities: ["build", "graph", "transform", "spa", "boundary-graph", "locale-switch", "rtl"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Rsbuild with Vue",
    /** The heading lives on the home route's component. */
    headingFile: "src/components/HelloWorld.vue",
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
