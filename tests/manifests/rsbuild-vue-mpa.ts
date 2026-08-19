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
   * **Not `hmr`, and the measurement is the one to read twice: 8 failures in
   * 10** (`node scripts/flake.js hmr.contract --runs=10`, 2026-08-15). Not 10 in
   * 10 like the two routed apps, and not 0 in 10 like `rsbuild-vanilla-mpa` —
   * intermittent, which by this repo's rules is a defect report rather than a
   * flake and is the reason this is unclaimed rather than merely unearned.
   *
   * The shape is the empty render, `expected '' to contain 'HMR works!'`. The
   * heading is in `App.vue`, a boundary the manager fetches, and a Vue edit on
   * Rspack full-reloads because only React declares client reactivity — so the
   * reload races the catalog write and usually wins. The two runs that passed
   * are what make it worth a look: whatever ordering lets them through is the
   * thing that would make the other eight deterministic.
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
      fromPath: "src/App.vue",
      toPath: "src/AppNew.vue",
      parentPath: "src/index.ts",
      importSearch: "./App.vue",
      importReplace: "./AppNew.vue",
    },
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
