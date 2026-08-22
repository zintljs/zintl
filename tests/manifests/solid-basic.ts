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
  /**
   * `hmr` yes, `hmr-warm` **no**, and the distinction is the whole point.
   *
   * A *catalog* edit is warm here now — `catalog-edit` measured 20 failures in
   * 20 runs before the applier stopped re-executing a boundary's source module
   * for an update the file can repaint from, and 0 in 20 after.
   *
   * A *source* edit is not, and should not be. `hmr-first-tick` edits the
   * heading file, which in this app is `src/App.tsx` — the file that also calls
   * `zintl()`. Re-running a Solid mount appends rather than replaces, so the
   * anchor file declines and the host reloads, which is correct. Measured
   * directly: `{"update":2,"full-reload":1}`, and the contract's own observer
   * dies with "Execution context was destroyed" because the page navigated.
   *
   * That is precisely the case `hmr-first-tick` excludes by requiring
   * `hmr-warm` — "a project that answers an edit with a full reload has none to
   * observe". Claiming `hmr-warm` here was a mistake of mine while restoring
   * capabilities for a baseline; it measured 10/20 red, and the fix is to stop
   * claiming something untrue rather than to chase the red.
   */
  capabilities: [
    "spa",
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
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
