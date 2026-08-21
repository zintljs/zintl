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
 * Solid on Vite.
 *
 * The first JSX dialect in the suite with **no subscription hook**. It takes its
 * dependency on the store through a `reactiveBridge`, which is why the
 * transform snapshots here are worth reading: they are the only JSX ones that
 * carry `_v:` on every `_t` call and no `useSyncExternalStore` anywhere.
 *
 * The capability list is deliberately shorter than `react-basic`'s. Every
 * capability here has been run; the ones that are absent — `chaos`,
 * `performance`, `memory`, the stress variants — are absent because they have
 * not been, and `tests/manifests/index.ts` is explicit that an inert claim
 * "costs nothing at runtime but misreports what is covered". They are cheap to
 * add once measured.
 */
export const solidBasic: ProjectManifest = {
  name: "solid-basic",
  source: copiedExampleSource("solid-basic"),
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
    headingFile: "src/App.tsx",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
