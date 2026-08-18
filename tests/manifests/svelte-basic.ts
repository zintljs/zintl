import {
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

export const svelteBasic: ProjectManifest = {
  name: "svelte-basic",
  source: copiedExampleSource("svelte-basic"),
  zintlOptions,
  capabilities: [
    "spa",
    "hmr",
    "hmr-structural",
    "hmr-warm",
    "locale-switch",
    "rtl",
    "boundary-graph",
    "hmr-stress",
    "locale-switch-stress",
    "chaos",
    "memory",
    "performance",
    "transform",
    "build",
    "graph",
  ],
  adapter: {
    /**
     * The two edits `hmr-growth` makes, on opposite sides of ZHMR's structural line.
     *
     * Svelte's entry is not re-execution-safe, so this is the first project to exercise
     * §4.2.2 — the reload route — on a framework rather than on a vanilla app.
     */
    addSink: {
      file: "src/App.svelte",
      anchorOn: "<h1>Get started</h1>",
      insert: `\n    <p id="new-sink">A brand new sentence</p>`,
      expectText: "A brand new sentence",
      selector: "#new-sink",
    },
    addAnchor: {
      file: "src/main.ts",
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
     * The contract used to carry a `switch (exampleName)` and throw for any
     * project it did not recognise — so claiming `chaos` meant editing the
     * contract, and a capability that was really contract-limited got
     * recorded as host-limited.
     */
    renameBoundary: {
      fromPath: "src/App.svelte",
      toPath: "src/AppNew.svelte",
      parentPath: "src/main.ts",
      importSearch: "./App.svelte",
      importReplace: "./AppNew.svelte",
    },
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/App.svelte",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: async (lab, locale) => {
      if (locale === "ar") {
        await lab.page.click("button:has-text('العربية')");
      } else if (locale === "en") {
        await lab.page.click("button:has-text('English')");
      } else if (locale === "es") {
        await lab.page.click("button:has-text('Español')");
      } else if (locale === "zh") {
        await lab.page.click("button:has-text('中文')");
      }
    },
  },
};
