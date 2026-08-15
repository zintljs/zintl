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
   * `hmr` is not claimed, for the reason measured on `rsbuild-svelte-basic`: the
   * heading is in the entry's boundary here, but the page also mounts a *fetched*
   * shared boundary, and the reload an edit triggers on a vanilla app races the
   * catalog write. `performance` is unclaimed on every Rspack project.
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
