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
  /** No localizable assets — see the example's config for why this is explicit. */
  assetsTarget: [],
};

/**
 * React on Rspack — a *framework* app on a non-Rollup host.
 *
 * Every other Rspack project here is vanilla, which meant every framework-shaped
 * question on this host was answered by inference from the Vite examples. One
 * such inference — the vanilla-only hypothesis, L-030 — was refuted the first
 * time it was measured against this app, so the inferences were not reliable.
 *
 * Claims grow the way `rsbuild-vanilla-basic`'s did: one at a time, each after its
 * contract passes here. That is what keeps the suite free of skipped tests.
 */
export const rsbuildReactBasic: ProjectManifest = {
  name: "rsbuild-react-basic",
  source: copiedExampleSource("rsbuild-react-basic"),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Build-time capabilities, the browser ones, and hot updates.
   *
   * `hmr` was claimed once L-032 fixed client reactivity — this app is the one
   * that genuinely hot-updates on Rspack, applying an edit in place where
   * `rsbuild-vanilla-basic` reloads. **But see the caveat under `hmr-stress` below: the
   * claim is real and is not yet reliable.**
   *
   * `locale-switch-stress` was added after `locale-storm` passed three
   * consecutive isolated runs here.
   *
   * **Not `memory`, and the measurement that settled it is worth keeping.** The
   * exclusion had been inherited from `rsbuild-vanilla-basic` — where every edit is a page
   * reload — and none of that reasoning applies here, since this app updates in
   * place. Measured in isolation it passes **10 runs in 10**.
   *
   * It still cannot be claimed: in the **full suite** it fails **3 in 3**, and
   * takes `hmr` and `syntax-recovery` on this project down with it once each.
   * `memory-leak` drives twenty sequential edits, and twenty edits on an Rspack
   * dev server competing with three other workers is simply more than the budget
   * allows.
   *
   * A capability is a claim about the suite, not about a contract run alone, so
   * isolation is the wrong instrument for the last word — `node scripts/flake.js
   * all` is.
   *
   * `hmr-hammer`, `chaos-catalog` and `memory-leak` each exhausted the 45s
   * budget. That is **not** the per-edit throughput it looks like: a probe
   * measured `react-basic` at a 173 ms mean per edit and could not complete a
   * *single* edit here inside the same budget, while a zero-edit probe showed
   * server startup costs about a second. Something in the edit path stalls
   * rather than runs slowly, and the same shape is visible in `hmr` itself —
   * `[HMR Propagation] rsbuild-react-basic` fails roughly one isolated run in three.
   * A claimed capability that is intermittent is a defect report rather than a
   * flake (CLAUDE.md, `retry: 0`), so the gap here is not "more capabilities
   * wanted" but "the one already claimed needs diagnosing". Ledger L-039.
   *
   * `chaos-boundary` is different and fails immediately: it carries a
   * per-example `switch` and throws `Unsupported example for boundary rename`.
   * That contract names apps, which the contract layer is not supposed to do —
   * the rename belongs in an adapter. Its own comment already says so. Even
   * once relaxed, `chaos` needs `chaos-catalog` too, so it is behind L-039
   * regardless.
   *
   * **Not `assets`.** This app localizes no asset; `rsbuild-vanilla-basic` covers that
   * path on this host.
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
    "hmr-structural",
    "hmr-warm",
    "locale-switch-stress",
  ],
  adapter: {
    /**
     * The two edits `hmr-growth` makes, on opposite sides of ZHMR's structural line.
     *
     * The structural path had never run on Rspack at all. React first, because it is the
     * host's only project with a framework runtime that repaints from the store.
     */
    addSink: {
      file: "src/App.tsx",
      anchorOn: "<h1>Rsbuild with React</h1>",
      insert: `\n      <p id="new-sink">A brand new sentence</p>`,
      expectText: "A brand new sentence",
      selector: "#new-sink",
    },
    addAnchor: {
      file: "src/index.tsx",
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
    /**
     * Which file `chaos-boundary` renames, and who imports it.
     *
     * Present but **not claimed**: with this config in place the contract runs
     * and fails 10 times in 10. The trace says why, and it is not the rename —
     * `watch (batch) → 1 modified` lists only the entry, so the newly created
     * `AppNew.tsx` never reaches the watch hook at all, and its boundary
     * (`b_src_AppNew_tsx_default`) has no catalog by the time the page asks. A
     * file created outside the dependency graph and imported in the same cycle
     * is a gap in how this host reports changes, not in the rename itself.
     *
     * The contract used to carry a `switch (exampleName)` and throw for any
     * project it did not recognise — so claiming `chaos` meant editing the
     * contract, and a capability that was really contract-limited got
     * recorded as host-limited.
     */
    renameBoundary: {
      fromPath: "src/App.tsx",
      toPath: "src/AppNew.tsx",
      parentPath: "src/index.tsx",
      importSearch: "./App",
      importReplace: "./AppNew",
    },
    headingSelector: "h1",
    initialHeadingText: "Rsbuild with React",
    /** The heading lives in the component, not the entry — see the example's README. */
    headingFile: "src/App.tsx",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/?lang=${locale}`);
    },
    /** As on `rsbuild-vanilla-basic`: Rspack emits catalogs as hashed async chunks. */
    isCatalogRequest: (url) => url.includes("/static/js/async/"),
    switchLocale: async (lab, locale) => {
      if (locale === "ar") await lab.page.click("button:has-text('العربية')");
      else if (locale === "en") await lab.page.click("button:has-text('English')");
      else if (locale === "es") await lab.page.click("button:has-text('Español')");
      else if (locale === "zh") await lab.page.click("button:has-text('中文')");
    },
  },
};
