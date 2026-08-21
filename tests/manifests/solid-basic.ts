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
   * `solid-basic` is the suite's reproduction for a sharp edge that is **not**
   * about Solid, and this comment replaces one that said it was.
   *
   * The earlier claim here — "a Solid component does not self-accept a catalog
   * invalidation, so it propagates to the entry" — was wrong. What actually
   * happens is that the applier invalidates the *boundary's own source module*
   * on a catalog update, and in this app the edited string's boundary is
   * `src/App.tsx`, which is also the file that calls `zintl()`. Zintl's injected
   * handler on an anchor file declines when the framework's mount is not
   * replayable, and declining bubbles to a reload.
   *
   * Every other example escapes by accident rather than by design: React, Preact,
   * Vue and Svelte keep the anchor in a different file from their strings, and
   * `vanilla-spa-basic` has both in one file but vanilla's
   * `entryReexecutionSafe` defaults to `true`. So the edge belongs to any
   * non-replayable framework — Solid, Svelte, Lit — whenever a translatable
   * string sits in a file that calls `zintl()`.
   *
   * The anchor stays in `src/App.tsx` deliberately. Moving it would make the
   * symptom disappear without fixing anything and would cost the suite its only
   * reproduction.
   *
   * What was measured and remains true: `render(code, el)` called twice on the
   * same element leaves **two** children, not one. It appends. That is why
   * `solidRuntimeFacet` declares `entryReexecutionSafe: false`, and it is
   * correct — the fix is that a *catalog* update no longer needs the mount to
   * re-run at all. Also ruled out: the template's `/* @refresh reload *\/`,
   * which changes nothing when removed and stays because it is the template's.
   */
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
