import type { ExampleManifest } from "@zintl/testing";

export const reactBasic: ExampleManifest = {
  name: "react-basic",
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
  ],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/App.tsx",
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
