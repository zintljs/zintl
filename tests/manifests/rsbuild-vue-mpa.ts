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
  /** No localizable assets — `rsbuild-vanilla-basic` covers that path on this host. */
  assetsTarget: [],
};

/**
 * Two Vue roots across two documents — the multi-entry HTML path with a
 * framework on it.
 *
 * `rsbuild-vanilla-mpa` established that `declareHtmlEntriesHook` and
 * `entriesFor` pick the right template per emitted document. This asks the same
 * question of a framework app, and adds one thing the vanilla version cannot:
 * the shared boundary is an **async component**. `SiteHeader.vue` awaits
 * `zintl(locale)` at the top level of `<script setup>`, so both pages mount it
 * through `<Suspense>` — a different mounting story from an async function call,
 * and the one a real Vue app would write.
 */
export const rsbuildVueMpa: ProjectManifest = {
  name: "rsbuild-vue-mpa",
  source: copiedExampleSource("rsbuild-vue-mpa"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * There is no `mpa` capability, and adding one would be the wrong shape — see
   * `rsbuild-vanilla-mpa` for the reasoning. What makes this project worth
   * running is that the ordinary contracts now run against an app with two
   * documents *and* a framework.
   *
   * `hmr` is not claimed, for the reason measured on `rsbuild-svelte-basic`.
   * `performance` is unclaimed on every Rspack project.
   */
  capabilities: ["build", "graph", "transform", "spa", "boundary-graph", "locale-switch", "rtl"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Rsbuild with Vue",
    headingFile: "src/App.vue",
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
