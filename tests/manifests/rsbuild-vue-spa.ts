import {
  clickLocaleBar,
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
   * **Not `hmr`, and now measured: 10 failures in 10**
   * (`node scripts/flake.js hmr.contract --runs=10`, 2026-08-15), against
   * `rsbuild-vanilla-mpa` failing 0 in 10 in the same batch. Deterministic.
   *
   * Two things stack here. Only React declares client reactivity, so a Vue edit
   * on Rspack declines the update and full-reloads; and the heading lives on a
   * lazily-imported route, so the reloaded page has to *fetch* that boundary and
   * loses the race with the catalog write. The failure is the empty render,
   * `expected '' to contain 'HMR works!'`.
   *
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
    "hmr",
    "hmr-warm",
  ],
  adapter: {
    /**
     * **`chaos` is not claimed: this project cannot fit the contract in the
     * cap.** Not a defect — a budget.
     *
     * `chaos-catalog` is the longest contract in the suite (delete a catalog,
     * edit, assert, corrupt it, edit, assert, restore, edit, reload, assert),
     * and a Vue-on-Rspack lab spends around seven seconds on setup before it
     * starts. That leaves roughly 23 s of the 45 s cap, and this project
     * consistently needs more: green in isolation, red on `ready:examples`
     * twice in two runs. Removing the contract's redundant pre-chaos locale
     * round trip bought enough for `rsbuild-vue-mpa` and not for this one.
     *
     * Claimed again when either the contract gets cheaper or lab setup does.
     * The other four Rsbuild projects claim `chaos` and pass.
     */
    /** Which file `chaos-boundary` renames, and who imports it. */
    renameBoundary: {
      fromPath: "src/components/HelloWorld.vue",
      toPath: "src/components/HelloWorldNew.vue",
      parentPath: "src/router.ts",
      importSearch: "./components/HelloWorld.vue",
      importReplace: "./components/HelloWorldNew.vue",
    },
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
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
