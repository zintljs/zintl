import {
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

export const vueBasic: ProjectManifest = {
  name: "vue-basic",
  source: copiedExampleSource("vue-basic"),
  zintlOptions,
  capabilities: [
    "spa",
    "hmr",
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
     * Which file `chaos-boundary` renames, and who imports it.
     *
     * The contract used to carry a `switch (exampleName)` and throw for any
     * project it did not recognise — so claiming `chaos` meant editing the
     * contract, and a capability that was really contract-limited got
     * recorded as host-limited.
     */
    renameBoundary: {
      fromPath: "src/components/HelloWorld.vue",
      toPath: "src/components/Hello.vue",
      parentPath: "src/App.vue",
      importSearch: "./components/HelloWorld.vue",
      importReplace: "./components/Hello.vue",
    },
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/components/HelloWorld.vue",
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
