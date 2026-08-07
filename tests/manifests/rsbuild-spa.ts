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
  assetsTarget: ["txt"],
};

/**
 * Zintl under Rsbuild — the only example driven by a bundler that is not Vite.
 *
 * Began as proposal 026's falsification target, living outside `examples/` so it
 * carried none of that directory's obligations. Proposal 027 promoted it, which
 * means it now builds under `vpr build:examples`, satisfies lint and knip, and is
 * something a user is invited to copy.
 *
 * **Capabilities are the scope control here, and they are the whole mechanism.**
 * Contract matching is a positive-only subset test (`runner.ts`), so a manifest
 * claiming exactly what it can satisfy is skipped by every contract requiring
 * more — no contract edits, no `excludes` mechanism, no `bundler:*` dimension.
 * That answered 026 §9 Q1 in the negative, which is the useful direction:
 * adding the dimension pre-emptively would have answered it by assumption.
 *
 * Each entry below was added only after its contract passed against this host.
 * That discipline is why the suite has no skipped tests, and it is the reason
 * the list is shorter than the Vite examples' rather than aspirational.
 */
export const rsbuildSpa: ProjectManifest = {
  name: "rsbuild-spa",
  source: copiedExampleSource("rsbuild-spa"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Build-time capabilities, plus the browser ones that do not involve hot
   * updates.
   *
   * `spa` became claimable once the dev-server driver seam existed, and it buys
   * the thing nothing else covered: whether an app Zintl built through Rspack
   * actually *runs* in a browser rather than merely producing plausible bytes.
   *
   * `assets` covers the `.txt` this app localizes, and is the capability that
   * exercises the L-009 fix in a real browser rather than only in a committed
   * snapshot — an Rspack build that base64s Zintl's generated JavaScript into a
   * `data:` URI is green everywhere else.
   *
   * `boundary-graph` needs no host support at all: it introspects the compiler,
   * which is the half of the system that was already portable.
   *
   * **Not `locale-switch`/`rtl`.** The store now sets `<html lang>` and `dir` on
   * any host, but the direction map is derived from HTML catalogs, and on this
   * host no HTML document reaches a boundary: an Rsbuild template carries no
   * `<script src>`, because the entry is injected from `source.entry`. So the
   * map is empty here and `dir` never changes. That link is Rsbuild
   * configuration, which arrives with the HTML seam — ledger L-021.
   *
   * **Not `performance`.** `performance-size` requires `locale-switch`, so it is
   * blocked by the same thing rather than by anything about performance.
   *
   * **Not `hmr` or anything built on it.** Zintl emits no acceptance code on
   * this host (`rspackFacet`), because ZDB §7a makes dev support conditional on
   * two ordering guarantees not established here. Note `hmr-stress` does *not*
   * require `hmr` — claiming it alone would select `hmr-hammer` and fail rather
   * than skip.
   */
  capabilities: ["build", "graph", "transform", "spa", "assets", "boundary-graph"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/main.ts",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    /** The asset is `src/about.txt`, rendered into `#about` — not the heading. */
    assetSelector: "#about",
    assetText: {
      en: "Zintl keeps translations next to the code that needs them.",
      ar: "يبقي Zintl الترجمات بجانب الشيفرة التي تحتاجها.",
    },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/?lang=${locale}`);
    },
    switchLocale: async (lab, locale) => {
      if (locale === "ar") await lab.page.click("button:has-text('العربية')");
      else if (locale === "en") await lab.page.click("button:has-text('English')");
      else if (locale === "es") await lab.page.click("button:has-text('Español')");
      else if (locale === "zh") await lab.page.click("button:has-text('中文')");
    },
  },
};
