import {
  clickLocaleBar,
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
   * **`hmr` is claimed, and it took a contract fix rather than a product one.**
   * Measured 2026-08-15: `[HMR Propagation] rsbuild-vanilla-mpa` failed **0 runs
   * in 10** (`node scripts/flake.js hmr.contract --runs=10`), in the batch where
   * `rsbuild-vanilla-spa` and `rsbuild-vue-spa` each failed 10 in 10. The heading
   * is in the entry's own boundary, which the manager inlines, so the full reload
   * a vanilla edit triggers comes back with the text already present.
   *
   * What blocked the claim was two other contracts gated behind the same
   * capability: `delivery-ordering` and `delivery-refresh` both aborted with
   * `Could not exercise ordering: no boundary carries "Vanilla Rsbuild"`. That was
   * an assumption in the contract rather than a defect in delivery — they looked
   * the heading key up in `store.catalogs[activeLocale]` at first paint, and on
   * this app that map holds `b_src_about_render` and
   * `b_src_components_Header_Header` but not `b_src_index_render`. Inspected in
   * a live page: under `ar` all three boundaries are present and both documents
   * render fully translated, so nothing was undelivered. The source locale is
   * ghosted, and the entry's own boundary is inlined into the manager rather
   * than registered as a catalog — which is exactly the boundary the contracts
   * went looking for.
   *
   * Both now pick their probe through `pickDeliveryProbe`, which falls back to
   * any registered boundary, so what they assert is the receiver's rule rather
   * than an assumption about how the app was chunked. Ledger L-056.
   *
   * Measured before claiming, 2026-08-16, `--no-build` against a confirmed
   * `dist`: `hmr.contract` **0/10**, `syntax-recovery` **0/10**, `delivery`
   * (failure + ordering + refresh) **0/10**. Thirty runs, no failure.
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
  ],
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
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
