import {
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
  similarityThreshold: 0.01,
  /** No localizable assets — `rsbuild-vanilla-basic` covers that path on this host. */
  assetsTarget: [],
};

/**
 * Vue 3 on Rspack — the project that found L-051 and now guards the fix.
 *
 * It is worth being precise about what this covers, because the defect it
 * exposed was invisible to every contract that existed at the time. Vue on
 * Rspack extracted correctly, scaffolded correct catalogs, passed
 * `verifyIntegrity`, emitted correct catalog chunks and localized the document
 * — and rendered the source locale, because `vue-loader`'s per-block requests
 * carried Zintl's transform on Vite's terms and not on Rspack's. A snapshot of
 * compiler output would have been green. What catches it is `locale-switch`
 * and `initial-render`: contracts that read the *page*.
 *
 * So the capability that matters here is `spa`, and the reason to keep this
 * project is that it is the only Vue app on a non-Rollup host.
 */
export const rsbuildVueBasic: ProjectManifest = {
  name: "rsbuild-vue-basic",
  source: copiedExampleSource("rsbuild-vue-basic"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Claims grow one at a time, each after its contract passes here.
   *
   * `hmr` is not claimed, for the reason measured on `rsbuild-svelte-basic`:
   * only React declares client reactivity, so a Vue edit on Rspack full-reloads,
   * and a reload racing the catalog write loses when the edited string lives in
   * a boundary the manager has to fetch rather than in the entry's inlined one.
   * `performance` is unclaimed on every Rspack project.
   */
  capabilities: [
    "build",
    "graph",
    "transform",
    "spa",
    "boundary-graph",
    "locale-switch",
    "rtl",
    "locale-switch-stress",
  ],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Rsbuild with Vue",
    /** The heading lives in the component, not the entry. */
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
