import type { ExampleManifest } from "@zintl/testing";

export const reactSsr: ExampleManifest = {
  name: "react-ssr",
  capabilities: ["ssr", "hmr", "locale-switch", "rtl", "boundary-graph"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/App.tsx",
    ssrPath: (locale) => `/${locale}/`,
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/en/`);
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
