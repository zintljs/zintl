import {
  clickLocaleBar,
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

/**
 * Preact on Vite.
 *
 * Its value in this suite is comparative rather than novel: it shares React's
 * extraction surface exactly, so a divergence between this project's graph and
 * `react-basic`'s is attributable to the two declarations that differ — the
 * `preact/compat` hook and `entryReexecutionSafe` — rather than to anything
 * about JSX.
 *
 * The capability list is deliberately shorter than `react-basic`'s. Every
 * capability here has been run; the ones that are absent — `chaos`,
 * `performance`, `memory`, the stress variants — are absent because they have
 * not been, and `tests/manifests/index.ts` is explicit that an inert claim
 * "costs nothing at runtime but misreports what is covered". They are cheap to
 * add once measured.
 */
export const preactBasic: ProjectManifest = {
  name: "preact-basic",
  source: copiedExampleSource("preact-basic"),
  zintlOptions,
  capabilities: [
    "spa",
    "hmr",
    "hmr-warm",
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
    headingFile: "src/app.tsx",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
