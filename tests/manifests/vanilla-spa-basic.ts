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
};

export const vanillaSpaBasic: ProjectManifest = {
  name: "vanilla-spa-basic",
  source: copiedExampleSource("vanilla-spa-basic"),
  zintlOptions,
  capabilities: [
    "spa",
    "hmr",
    "hmr-warm",
    "locale-switch",
    "rtl",
    "boundary-graph",
    "hmr-stress",
    "hmr-structural",
    "locale-switch-stress",
    "chaos",
    "chaos-boundary",
    "memory",
    "performance",
    "transform",
    "build",
    "graph",
  ],
  adapter: {
    /**
     * The host's round trip with nothing for Zintl to do — a comment inside the
     * script region, which every dialect here accepts and no extractor reads.
     */
    perfNoopEdit: {
      file: "src/main.ts",
      anchorOn: `import "./style.css";`,
      insert: `\n// zintl perf baseline`,
    },
    /**
     * The two edits `hmr-growth` makes. Both land in `src/main.ts` here — this
     * app has one file, which is what makes it the clearest place to see that
     * the warm and structural paths differ by the *kind* of change rather than
     * by which file changed.
     */
    addSink: {
      file: "src/main.ts",
      anchorOn: "<h1>Get started</h1>",
      insert: `\n    <p id="new-sink">A brand new sentence</p>`,
      expectText: "A brand new sentence",
      selector: "#new-sink",
    },
    addAnchor: {
      file: "src/main.ts",
      anchorOn: `import { localeBar, setupSwitcher } from "./switcher.ts";`,
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
     * The contract used to carry a `switch (exampleName)` and throw for any
     * project it did not recognise — so claiming `chaos` meant editing the
     * contract, and a capability that was really contract-limited got
     * recorded as host-limited.
     */
    renameBoundary: {
      fromPath: "src/main.ts",
      toPath: "src/mainNew.ts",
      parentPath: "index.html",
      importSearch: "/src/main.ts",
      importReplace: "/src/mainNew.ts",
    },
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/main.ts",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
