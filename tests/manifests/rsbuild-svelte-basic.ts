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
 * Svelte 5 on Rspack — the second *framework* app Zintl has on a non-Rollup host.
 *
 * It exists to answer a question the support statement had been carrying as
 * "untested here rather than unsupported", which is a promise with nothing
 * behind it. The answer is that Svelte needed no Zintl change at all: the
 * transform reaches `svelte-loader` intact, and extraction, chunk-aligned
 * catalogs, ghost mode and the HTML projection all behave as on Vite.
 *
 * **The same question asked of Vue came back the other way**, which is why
 * there is no `rsbuild-vue-*` manifest next to this one. `vue-loader` compiles
 * an SFC through per-block child requests that do not carry a pre-loader's
 * output, so Zintl's codegen is silently dropped while its catalogs stay
 * correct — the app builds green and renders the source locale. Ledger L-051.
 *
 * This app is also the only project in the suite whose catalogs use the
 * **default** layout (`zintl/`, `[path].[locale].json`). Both other Rspack
 * projects use the shared `translations.json` format, so until this one existed
 * the default format had no coverage on this host at all.
 */
export const rsbuildSvelteBasic: ProjectManifest = {
  name: "rsbuild-svelte-basic",
  source: copiedExampleSource("rsbuild-svelte-basic"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Claims grow one at a time, each after its contract passes here — the
   * discipline `rsbuild-vanilla-basic` established, and the reason the suite
   * carries no skipped tests.
   *
   * `locale-switch-stress` was claimed after `locale-storm` passed; so did the
   * three `delivery-*` contracts, which is worth noting because they are the
   * ones that prove ordering rather than repaint.
   *
   * **Not `hmr`, and this one is measured rather than reasoned: 10 failures in
   * 10** (`node scripts/flake.js hmr.contract --runs=10`, 2026-08-14), in the
   * same batch where `rsbuild-react-basic` and `rsbuild-vanilla-basic` passed
   * 10 in 10. That is a deterministic failure, not an intermittency.
   *
   * The shape, from the contract's own diagnosis: the edit reaches the compiler
   * (`watch (batch) → 1 modified`, `enter … App.svelte`), Rspack declines the
   * update because nothing accepts it (`Aborted because ./src/App.svelte is not
   * accepted`) and full-reloads, and the reloaded page then reports
   * `Missing key "HMR works!" in boundary "b_src_App_svelte"` and renders `""`.
   * So the reload wins the race against the catalog write.
   *
   * `rsbuild-vanilla-basic` reloads per edit too and does claim `hmr`, so
   * reload-per-edit is not by itself the cause. The difference is where the
   * heading lives: there it is the entry's own boundary, whose catalog the
   * manager inlines for the active locale, so a reload comes back correct
   * immediately. Here it is a component boundary the manager has to fetch, and
   * on the first paint after the reload it has not arrived. Same family as
   * L-041.
   *
   * `hmr-stress` and `memory` follow `hmr` and are not claimed either.
   * `performance` is unclaimed on every Rspack project — `performance-size`
   * filters responses by Vite-shaped URLs and its own header concedes it
   * measures dev-wrapped modules. `assets` is `rsbuild-vanilla-basic`'s job.
   * `chaos` needs `chaos-catalog`, which is behind `hmr`.
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
    "hmr",
    "hmr-structural",
  ],
  adapter: {
    /**
     * The two edits `hmr-growth` makes, on opposite sides of ZHMR's structural line.
     *
     * Svelte on Rspack, which reloads rather than hot-replaces (L-063), so §4.1③'s
     * no-reload half is the interesting assertion here.
     */
    addSink: {
      file: "src/App.svelte",
      anchorOn: "<h1>Rsbuild with Svelte</h1>",
      insert: `\n      <p id="new-sink">A brand new sentence</p>`,
      expectText: "A brand new sentence",
      selector: "#new-sink",
    },
    addAnchor: {
      file: "src/index.ts",
      anchorOn: `import { zintl } from "zintljs/macro";`,
      insert: [
        ``,
        ``,
        `// A second, independent trust anchor — nested in a function, so it is a`,
        `// new boundary rather than a second entry point.`,
        `async function extraAnchor() {`,
        `  // A *variable* locale, deliberately: a literal is a build-time fact the`,
        `  // compiler bakes, and baking the source locale emits no catalog chunk at`,
        `  // all — so the graph might not grow, and the contract would assert on a`,
        `  // structural change that never happened.`,
        `  const extraLang = new URLSearchParams(window.location.search).get("x") || "ar";`,
        `  await zintl(extraLang);`,
        `  document.title = "Extra anchor added";`,
        `}`,
      ].join("\n"),
    },
    headingSelector: "h1",
    initialHeadingText: "Rsbuild with Svelte",
    /** The heading lives in the component, not the entry. */
    headingFile: "src/App.svelte",
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
