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
 * Two documents on Rspack — the first project in the suite, on **either** host,
 * that drives Zintl's multi-entry HTML path.
 *
 * `declareHtmlEntriesHook` and `entriesFor` (`packages/zintl/src/hooks/html.ts`)
 * were written for more than one entry: one builds a document → scripts map, the
 * other inverts an emitted filename back to the template that produced it, and
 * both carry warnings for the ambiguous case. All of that had only ever run
 * against a single `index`, because every other Rspack project has one entry and
 * the four Vite MPA examples have no manifest at all. So the code that picks
 * *which* template to project was covered only where there was one to pick.
 *
 * It also covers the shared-boundary case in the same app:
 * `src/components/Header.ts` is imported by both pages and anchors itself, so
 * its strings form one boundary rather than being duplicated per entry. On Vite
 * that needs a second example (`vanilla-mpa-shared`); here it is folded in.
 *
 * **Not `multiplex`.** Every anchor is `zintl(lang)` with a variable, so
 * auto-detection never asks for the per-locale HTML fan-out that is fenced on
 * this host (L-022). `tests/fixtures/multiplex-rsbuild-fence.ts` covers the
 * fence itself.
 */
export const rsbuildVanillaMpa: ProjectManifest = {
  name: "rsbuild-vanilla-mpa",
  source: copiedExampleSource("rsbuild-vanilla-mpa"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * There is no `mpa` capability, and adding one would be the wrong shape: what
   * makes this project worth running is not a contract only it can satisfy, it
   * is that the ordinary contracts now run against an app with two documents.
   * `build` and `transform` snapshot both entries; `graph` snapshots a boundary
   * graph with a shared node in it.
   *
   * `spa` is claimed in the harness sense — the browser contracts navigate to
   * `/` and assert against a client-rendered page, which is exactly what the
   * home document is. It says nothing about the app being single-page.
   *
   * **`hmr` is the interesting exclusion here, because the HMR contract itself
   * passes.** Measured 2026-08-15: `[HMR Propagation] rsbuild-vanilla-mpa`
   * failed **0 runs in 10** (`node scripts/flake.js hmr.contract --runs=10`),
   * in the batch where `rsbuild-vanilla-spa` and `rsbuild-vue-spa` each failed
   * 10 in 10. The heading is in the entry's own boundary, which the manager
   * inlines, so the full reload a vanilla edit triggers comes back with the text
   * already present.
   *
   * What blocks the claim is two other contracts gated behind the same
   * capability: `delivery-ordering` and `delivery-refresh` both abort with
   * `Could not exercise ordering: no boundary carries "Vanilla Rsbuild"`. That is
   * an assumption in the contract rather than a defect in delivery — it looks
   * the heading key up in `store.catalogs[activeLocale]` at first paint, and on
   * this app that map holds `b_src_about_render` and
   * `b_src_components_Header_Header` but not `b_src_index_render`. Inspected in
   * a live page: under `ar` all three boundaries are present and both documents
   * render fully translated, so nothing is undelivered. The source locale is
   * ghosted, and the entry's own boundary is inlined into the manager rather
   * than registered as a catalog — which is exactly the boundary the contract
   * goes looking for.
   *
   * Worth someone's time, because it is the one capability on this host that is
   * demonstrably earned and administratively unclaimable. The contract needs a
   * way to pick its probe boundary that does not assume the string it asserts on
   * is registered rather than inlined.
   *
   * `performance` is unclaimed on every Rspack project.
   */
  capabilities: ["build", "graph", "transform", "spa", "boundary-graph", "locale-switch", "rtl"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Vanilla Rsbuild",
    headingFile: "src/index.ts",
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
