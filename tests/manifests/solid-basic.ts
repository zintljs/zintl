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
  /**
   * No `hmr` claim, and it is a measured property of Solid rather than a gap in
   * Zintl.
   *
   * A catalog edit invalidates the component that reads it. A Solid component
   * does not self-accept that invalidation, so it propagates to its importer —
   * which is the entry — and re-running a Solid entry is not safe: measured in a
   * browser, `render(code, el)` called twice on the same element leaves **two**
   * children, not one. It appends. So `solidRuntimeFacet` declares
   * `entryReexecutionSafe: false` and the host correctly reloads instead.
   *
   * Ruled out on the way: the template's `index.tsx` opens with
   * `/* @refresh reload *\/`, which was the obvious suspect. Removing it changes
   * nothing — still `update, update, full-reload` — so the directive is not the
   * cause and stays, because it is the template's.
   *
   * `catalog-edit` and `hmr-first-tick` both require `hmr` and both are asking
   * for Fast Replacement (ZHMR §4.1), which a reload is not. Claiming it anyway
   * would turn a known property into two red contracts that say nothing new.
   * Switching locale from the bar is covered and works — that path goes through
   * the app's own signal, not through catalog delivery.
   */
  capabilities: ["spa", "locale-switch", "rtl", "boundary-graph", "transform", "build", "graph"],
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
