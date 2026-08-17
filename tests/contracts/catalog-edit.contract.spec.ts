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
   * **Green everywhere, and it took three separate defects to get here.**
   *
   * Measured red on six Rspack projects when written
   * (`node scripts/flake.js catalog-edit --runs=10`): 10/10 runs failing on
   * `rsbuild-svelte-basic` and `rsbuild-vanilla-spa`, 6–7/10 on four others,
   * 0/10 on the two MPAs and on every Vite project. The pattern read as L-056's
   * inlined-vs-fetched line and was recorded as a write race. It was neither.
   *
   * 1. **L-064 — the update was applied and invisible.** Projects with nothing
   *    subscribed to the store (vanilla, Svelte) took the catalog, applied it,
   *    and never repainted; Rspack's applier re-runs nothing, so the update was
   *    swallowed. They now decline it and reload, which is L-035's trade one
   *    module kind later.
   * 2. **L-068 — subscribers stranded on a replaced store.** React *was*
   *    subscribed, to the module-level default store it reached before
   *    `zintl()` resolved. `setActiveInstance` swapped the pointer and left the
   *    listeners behind: `listeners: 0` on the live store with
   *    `useSyncExternalStore` mounted.
   * 3. **L-069 — Vue had no reactive dependency to track.** Not a bug but a
   *    missing bridge: `_t('…')` is an ordinary call, and Vue re-renders on
   *    reactive reads it performed during render. Every generated call now
   *    carries `_v: __zintl_v.value`, so rendering a translation *is* reading
   *    the handle.
   *
   * Each hid the next, and each was invisible on Vite for the same reason — its
   * applier re-runs the entry on every boundary update, repairing all three by
   * accident. The second host is what made them visible, which is what it was
   * built for.
   *
   * `react-ssr` is absent from this list because it does not hot-update at all;
   * its `hmr` claim is withdrawn in its manifest, with the measurement.
   */
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
