import { exampleSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

export const svelteBasic: ProjectManifest = {
  name: "svelte-basic",
  source: exampleSource("svelte-basic"),
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
