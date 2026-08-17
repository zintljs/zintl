import {
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

export const reactSsr: ProjectManifest = {
  name: "react-ssr",
  source: copiedExampleSource("react-ssr"),
  zintlOptions,
  buildTargets: [
    { name: "dist" },
    { name: "dist-server", overrides: { build: { ssr: "src/entry-server.tsx" } } },
  ],
  /**
   * **`hmr` was claimed here for this project's whole life and never once
   * tested.** Every hot-update contract required `["spa", "hmr"]`, and this
   * project claims `ssr` rather than `spa` — so the capability selected zero
   * contracts. It read as coverage and was an empty entry in a list.
   *
   * Removing `spa` from those gates made it selectable, and the first
   * measurement it has ever had is red: an ordinary edit to `src/App.tsx` does
   * not reach the page. `[HMR First Tick] react-ssr` and `[Catalog Edit]
   * react-ssr` both fail the same way — `expected 'Get started' to contain …` —
   * so it is not specific to catalogs or to frames.
   *
   * So the claim is dropped rather than moved to `pendingFor` on five separate
   * contracts. A capability is a statement about the project, and the true
   * statement today is that this one does not hot-update. It should be
   * reinstated the moment that changes — SSR on Vite has every mechanism it
   * needs, which is what makes this a defect rather than a scope boundary.
   */
  capabilities: ["ssr", "locale-switch", "rtl", "boundary-graph", "transform", "build", "graph"],
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
