import {
  executeContract,
  findCatalogFor,
  setTranslation,
  type Contract,
  type LocaleSwitchAdapter,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * A translator edits a catalog and the page follows (ZHMR §3.2, §4.1①).
 *
 * **The most common thing anyone does with an i18n toolchain, and until now the
 * one hot-update path with no contract at all.** The suite edited *source*
 * strings (`hmr`, `hmr-hammer`), deleted catalogs and corrupted them
 * (`chaos-catalog`), and drove the receiver directly (`delivery-*`) — but
 * nothing ever wrote a valid new translation into a catalog JSON and checked it
 * arrived. That is the workflow the product exists to serve.
 *
 * Two claims, asserted separately because they fail for different reasons:
 *
 * 1. **The translation arrives.** ZHMR §3.2 — invalidating the content module
 *    causes dependent managers to re-import the fresh data.
 * 2. **It arrives warm.** ZHMR §4.1 lists a JSON translation edit first among
 *    the triggers for Fast Replacement, whose whole mechanism is
 *    `import.meta.hot.accept()` updating in place. A full reload delivers the
 *    same text and is a different thing: it discards application state, and on
 *    this project's own evidence (L-056) it can race the compiler's catalog
 *    write and deliver the *old* text instead.
 *
 * Driven in a target locale, necessarily. The source locale is ghosted — never
 * written to disk — so there is no source-locale catalog to edit and an attempt
 * to find one is not a failure but a category error.
 */

/** Left-to-right, so a failure here is never confused with an RTL defect. */
const LOCALE = "es";
const EDITED = "Traducción actualizada en caliente";

export const catalogEditContract: Contract<LocaleSwitchAdapter> = {
  name: "Catalog Edit",
  description: "Verifies editing a translation catalog updates the page without a full reload",
  requires: ["hmr", "locale-switch"],
  /**
   * **Green on every Vite project, 10 runs in 10. On Rspack it splits, and the
   * line it splits along is the finding.**
   *
   * The first run was green on 12 of 13, which looked like a clean result for
   * the single most common thing anyone does with an i18n toolchain. It was
   * one run. Measured properly (`node scripts/flake.js catalog-edit --runs=10`,
   * 10/10 runs carrying a failure):
   *
   * | Project                 | Runs failed |
   * | :---------------------- | :---------- |
   * | `rsbuild-svelte-basic`  | **10 / 10** |
   * | `rsbuild-vanilla-spa`   | **10 / 10** |
   * | `rsbuild-react-basic`   | 7 / 10      |
   * | `rsbuild-vue-spa`       | 7 / 10      |
   * | `rsbuild-vue-basic`     | 7 / 10      |
   * | `rsbuild-vanilla-basic` | 6 / 10      |
   * | `rsbuild-vanilla-mpa`   | 0 / 10      |
   * | `rsbuild-vue-mpa`       | 0 / 10      |
   * | every Vite project      | 0 / 10      |
   *
   * **The two that never fail are the two MPAs, and that is not a coincidence.**
   * L-056 established that on `rsbuild-vanilla-mpa` the heading lives in the
   * entry's own boundary, which the manager *inlines* for the active locale
   * rather than fetching. Phase 9 drew the dividing line there — inlined vs
   * fetched, not framework — and this contract reproduces it from the opposite
   * direction: a catalog edit is reliable exactly where the catalog is inlined,
   * and unreliable wherever the manager has to go and get it. The reload beats
   * the compiler's write, and the page re-renders from what was on disk a
   * moment ago.
   *
   * So this is not a new defect. It is L-056's, still live, exposed by the one
   * mutation neither `hmr` nor the delivery contracts perform — editing the
   * catalog *itself* rather than the source that generates it. Phase 9's thirty
   * clean runs were accurate for the mutations they made.
   *
   * The thirteenth project was `react-ssr`, which does not hot-update at all
   * rather than having a catalog-specific problem; its `hmr` claim is withdrawn
   * in its manifest, with the measurement.
   */
  /**
   * **Half of L-064 is fixed; the half that remains is a different question.**
   *
   * The three projects with no client reactivity — `rsbuild-vanilla-basic`,
   * `rsbuild-vanilla-spa`, `rsbuild-svelte-basic` — now pass. Their catalogs
   * were arriving and being applied all along; nothing in the page could redraw
   * from them, and Rspack's applier invalidates nothing, so the update was
   * *swallowed*: store correct, DOM a screenshot of the previous render. They
   * now reload instead, which is L-035's trade one module kind later.
   *
   * The three that remain are the reactive frameworks whose managers **fetch**
   * the catalog rather than inlining it. `rsbuild-vue-mpa` inlines and passes
   * warm; `rsbuild-vue-basic` and `rsbuild-vue-spa` are the same framework and
   * fetch, and fail. So the axis is not the framework — it is L-056's
   * inlined-vs-fetched line, arrived at a third time and from a third
   * direction. A fetched catalog on this host updates a module that nothing
   * re-runs and nothing is subscribed through.
   *
   * Left pending rather than forced to reload with the others: these projects
   * *can* repaint, so making them refresh the page would trade a real defect for
   * a worse experience and call it fixed.
   */
  /**
   * **React is fixed (L-068). Vue is not a bug — it has no reactivity bridge.**
   *
   * React's components subscribe through `useSyncExternalStore`, and the
   * subscription was landing on a store nothing would ever notify: anything
   * rendering before `zintl()` resolved reached the module-level
   * `defaultInstance`, and `setActiveInstance` swapped the pointer without
   * taking the listeners with it. Measured as `listeners: 0` on the live store
   * with React demonstrably mounted; `2` after the fix, and the contract passes.
   *
   * Vue is a different thing entirely, and the generated code says so plainly:
   *
   * ```
   * <h1>{{ _t('Rsbuild with Vue', { _mgr: …, _bId: 'b_src_App_vue' }) }}</h1>
   * ```
   *
   * `_t` is an ordinary function reading an ordinary object. Vue re-renders when
   * a *reactive dependency* changes and this template has none, so a new catalog
   * is invisible to it by construction — there is no subscription to strand.
   * `rsbuild-vue-mpa` passes for an unrelated reason: its catalog is inlined, so
   * the update lands on the manager, the entry re-runs, and the app remounts.
   * Vite passes for the same reason at the applier level.
   *
   * Closing it means giving Vue what React has — a reactive handle the template
   * depends on — which is a feature with a design rather than a defect with a
   * fix, and it is the one thing in this area that should not be attempted in a
   * hurry.
   */
  pendingFor: {
    "rsbuild-vue-basic":
      "Vue has no reactivity bridge: templates call _t() directly, which is not a reactive " +
      "dependency, so a delivered catalog cannot re-render a component. Needs a Vue equivalent " +
      "of React's useSyncExternalStore, not a bug fix. See L-068.",
    "rsbuild-vue-spa":
      "Same as rsbuild-vue-basic — fetched catalog, no reactive dependency on the store.",
  },
  async execute(lab, adapter, manifest) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    await adapter.switchLocale(lab, LOCALE);
    await lab.clock.waitForIdle();

    // The key a catalog is addressed by is the source text itself.
    const key = adapter.initialHeadingText;
    const probe = findCatalogFor(lab, { locale: LOCALE, key });
    if (!probe.ok) {
      throw new Error(`Could not locate a catalog to edit: ${probe.why}`);
    }
    if (!probe.carriesKey) {
      throw new Error(
        `No catalog for ${LOCALE} carries ${JSON.stringify(key)}, so editing one would not ` +
          `change the heading this contract asserts on. Nearest is ${probe.path} with ` +
          `${probe.keys.length} key(s): ${probe.keys.slice(0, 8).join(", ")}\n\n` +
          (await lab.assert.describeStall()),
      );
    }

    const capture = lab.ws.capture();

    await lab.fs.edit(probe.path, (content) => setTranslation(content, key, LOCALE, EDITED));

    // 1. The translation arrives.
    await lab.assert.textEventually(adapter.headingSelector, EDITED);

    /**
     * 2. It arrived warm — asserted only where the project claims to be able to.
     *
     * `hmr-warm` is the claim that a hot update is replaced *in place* rather
     * than answered by a reload, and it is a genuinely different guarantee from
     * `hmr`: a reload delivers the same text while discarding application
     * state. Measured, the line runs through client reactivity — a project with
     * nothing subscribed to the store has nothing that can redraw from a new
     * catalog, so declining the update and reloading is the correct outcome
     * rather than a failure to be warm (L-035 for source files, L-064 for
     * catalogs).
     *
     * Asserting warmth unconditionally would demand that every project meet a
     * guarantee only some of them make, which is what the capability model
     * exists to stop.
     */
    const packets = capture.stop();
    const claimsWarm = manifest.capabilities.includes("hmr-warm");
    const reloads = packets.filter((p) => p.type === "full-reload");
    if (claimsWarm && reloads.length > 0) {
      throw new Error(
        `The edited translation reached the page, but by full reload — ${reloads.length} ` +
          `full-reload packet(s) among ${packets.length}: ` +
          `${packets.map((p) => p.type).join(", ")}.\n\n` +
          `ZHMR §4.1 lists a JSON translation edit first among the triggers for Fast ` +
          `Replacement, whose mechanism is the manager's import.meta.hot.accept() updating in ` +
          `place. A reload delivers the same text while discarding application state, and it ` +
          `races the compiler's catalog write — which is how L-056's stale-text failure ` +
          `happened.`,
      );
    }
  },
};

executeContract(catalogEditContract, allManifests);
