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
   * `locale-switch`/`rtl` became claimable once the HTML seam existed. Both
   * halves were needed and neither alone was enough: `api.modifyHTML` to project
   * the document, and `htmlEntries` to tell the compiler which script an Rsbuild
   * template loads — without the second, no HTML document reached a boundary
   * here, no catalog was scaffolded, and the direction map was empty (L-021).
   *
   * **Not `performance`.** `performance-size` filters responses by Vite-shaped
   * URLs (`virtual:zintl`, `/i18n/`, `.json`) and sees none of this host's
   * hashed async chunks. Teaching it a second URL shape is not worth doing while
   * its own header documents it as measuring dev-wrapped modules inside a timing
   * window — that contract needs rewriting against built output before either
   * host should claim it.
   *
   * **The L-030 empty render is fixed here, and `hmr` is still not claimed —
   * for capacity, not capability.** A vanilla entry cannot recover from a late
   * catalog: its only repaint is re-running the entry, which rebuilds the store
   * from a module binding Webpack has cached. So the entry now declines to
   * accept and the update bubbles to a full page reload — slower than a hot
   * update and correct (ledger L-035). The `hmr` contract passes here when run
   * on its own.
   *
   * It is left unclaimed because every edit is now a full reload, which is
   * markedly more expensive than a hot update, and the full suite began timing
   * out on `rsbuild-react` when it was claimed. Whether that is a real capacity
   * limit is **not established**: the timeouts moved between runs and reached
   * projects this change cannot affect (`memory-leak` on `svelte-basic`, a Vite
   * project), which is the signature of a loaded machine rather than of the
   * suite. Re-measure on a quiet one before deciding.
   *
   * Nothing is unguarded in the meantime. The codegen decision is recorded by
   * this project's dev-transform snapshot — the entry no longer emits
   * `webpackHot.accept()` — and the runtime outcome is covered by
   * `rsbuild-react`, which exercises the same host with reactivity present. The
   * `hmr` contract also passes here when run on its own.
   *
   * **Not `memory`.** `memory-leak` drives twenty sequential edits, and each one
   * here is a page reload. A reload resets the settle beacon to the same value
   * it had before, which is precisely the shape `waitForSettled` cannot confirm
   * (L-029) — so every iteration would wait out its full timeout. It would also
   * be measuring nothing: a reload resets the heap, so "growth across twenty
   * hot updates" has no meaning when there are no hot updates. Inferred from
   * L-029's measured mechanism rather than re-measured here.
   *
   * **Not `chaos`.** A limitation of `chaos-boundary`, not of this host: it
   * renames the file holding the heading, and here that file is the entry, which
   * Rsbuild names in `rsbuild.config.mjs` rather than in `index.html`. Renaming
   * it is a config change that restarts the dev server. Content-based boundary
   * identity is covered by `boundary-graph` regardless; see that contract's own
   * `getRenameConfig` for what would need relaxing.
   */
  capabilities: [
    "build",
    "graph",
    "transform",
    "spa",
    "assets",
    "boundary-graph",
    "locale-switch",
    "rtl",
    "locale-switch-stress",
  ],
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
    /**
     * Rspack emits catalogs as ordinary hashed async chunks, so unlike Vite's
     * virtual modules nothing in the URL names a locale. This app has exactly
     * one async chunk per non-source locale, so an async-chunk fetch during a
     * switch is a catalog fetch — but it cannot prove *which* locale, which the
     * Vite spelling can. Recorded rather than papered over.
     */
    isCatalogRequest: (url) => url.includes("/static/js/async/"),
    switchLocale: async (lab, locale) => {
      if (locale === "ar") await lab.page.click("button:has-text('العربية')");
      else if (locale === "en") await lab.page.click("button:has-text('English')");
      else if (locale === "es") await lab.page.click("button:has-text('Español')");
      else if (locale === "zh") await lab.page.click("button:has-text('中文')");
    },
  },
};
