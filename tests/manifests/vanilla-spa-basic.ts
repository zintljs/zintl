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
};

export const vanillaSpaBasic: ProjectManifest = {
  name: "vanilla-spa-basic",
  source: copiedExampleSource("vanilla-spa-basic"),
  zintlOptions,
  capabilities: [
    "spa",
    "hmr",
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
