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
   * **`hmr` was claimed here for this project's whole life, never tested, then
   * withdrawn on its first measurement — and it is earned now.**
   *
   * Every hot-update contract used to require `["spa", "hmr"]`, and this
   * project claims `ssr` rather than `spa`, so the capability selected zero
   * tests. It read as coverage and was an empty entry in a list. Removing `spa`
   * from those gates made it selectable and the first measurement it ever had
   * was red: an ordinary edit to `src/App.tsx` did not reach the page, on
   * `[HMR First Tick]` and `[Catalog Edit]` alike. The claim was dropped rather
   * than pended, because a capability is a statement about the project and the
   * true statement then was that this one did not hot-update.
   *
   * **What was wrong was in `server.js`, not in Zintl.** In middleware mode
   * Vite has no listener to attach its HMR WebSocket to, so unless it is handed
   * one it opens a second on a fixed port — 24678, the same one for every SSR
   * app in the suite, across four workers. Whichever bound first owned it and
   * every other page connected to nothing. The server sent updates correctly
   * and no browser was listening, which is indistinguishable from a compiler
   * that never sent them.
   *
   * Passing the http server through (`hmr: { server }`) reinstates the claim:
   * `[HMR Propagation]` and `[Catalog Edit]` both pass. The same one-line fix
   * earned `hmr` on the other three SSR examples, which had never claimed it.
   */
  capabilities: [
    "ssr",
    "hmr",
    "locale-switch",
    "rtl",
    "boundary-graph",
    "transform",
    "build",
    "graph",
  ],
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
