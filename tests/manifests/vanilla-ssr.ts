import {
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

/**
 * Capabilities are deliberately narrower than `react-ssr`'s.
 *
 * That manifest also claims `hmr`, `locale-switch` and `rtl`, none of which
 * match anything: every contract requiring them also requires `spa`, which an
 * SSR project does not have. Inert claims cost nothing at runtime but they
 * misreport what is covered, which is the one thing a capability list is for.
 */
export const vanillaSsr: ProjectManifest = {
  name: "vanilla-ssr",
  source: copiedExampleSource("vanilla-ssr"),
  zintlOptions,
  buildTargets: [
    { name: "dist" },
    { name: "dist-server", overrides: { build: { ssr: "src/entry-server.ts" } } },
  ],
  capabilities: ["ssr", "hmr", "boundary-graph", "transform", "build", "graph"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/entry-server.ts",
    ssrPath: (locale) => `/${locale}/`,
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/en/`);
    },
    switchLocale: async (lab, locale) => {
      const label = { en: "English", ar: "العربية", es: "Español", zh: "中文" }[locale];
      if (label) await lab.page.click(`button:has-text('${label}')`);
    },
  },
};
