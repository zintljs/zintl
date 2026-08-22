import { executeContract, type Contract, type HmrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { catalogLocale, insert } from "./structural-edit.js";

/**
 * The graph grows, and the update mechanism changes with it (ZHMR §4.1③).
 *
 * Every other hot-update contract edits a string that already exists. That is
 * the easy half of the specification: nothing about the boundary graph moves,
 * so one mechanism serves the whole run. ZHMR draws its sharpest line somewhere
 * else — between a change that *fits* the existing graph and one that reshapes
 * it — and puts different machinery on each side. This file is the first side:
 *
 * - **§4.1③, adding a sink.** New content inside a boundary that already
 *   exists. Fast Replacement: the manager accepts in place, and a new key has
 *   to reach the catalog on disk for a translator to find.
 * - **§4.2, adding an anchor or a `$L` colony.** The graph's *shape* changed —
 *   see `hmr-growth.contract.spec.ts`.
 *
 * The edit is adapter-declared: *where* a sink can go is framework syntax, and
 * a contract that synthesised it would be naming apps again.
 *
 * `HMR Sink`, `HMR Sink Warm` and `HMR Growth` shared one file until it was
 * measured as the longest in the suite at 172 s. A worker takes a whole file, so
 * that number was a floor nothing could parallelise past; the three are
 * independent contracts and are now three files. Their shared helpers are in
 * `structural-edit.ts` — see the note there for why they cannot live in a spec.
 */
export const hmrSinkContract: Contract<HmrAdapter> = {
  name: "HMR Sink",
  description: "Verifies a new sink renders and its key reaches a catalog on disk",
  requires: ["hmr", "hmr-structural"],
  /**
   * Both halves of §4.1③ are asserted again, and both causally.
   *
   * The catalog-write claim this contract used to carry was recorded as ledger
   * L-066 and deleted from the body, because the only way to ask it then was a
   * wall-clock poll. It is back — see the comment where it stood — now that
   * `catalogContains` waits on the compiler's dirty set instead of a budget.
   */
  async execute(lab, adapter) {
    const { addSink } = adapter;
    if (!addSink) {
      throw new Error(
        `This project claims "hmr-structural" without declaring "addSink". The capability is ` +
          `exactly the claim that it can describe that edit.`,
      );
    }

    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    // ──────────────────────────────────────────────────────────────────
    // §4.1③ — a new sink is the warm path
    // ──────────────────────────────────────────────────────────────────
    const warmCapture = lab.ws.capture();
    await insert(lab, addSink, "addSink");

    if (addSink.expectText) {
      await lab.assert.textEventually(
        addSink.selector ?? adapter.headingSelector,
        addSink.expectText,
      );
    } else {
      // Nothing new is rendered, so the guarantee is only that the existing
      // heading survived the edit rather than blanking.
      await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);
    }

    warmCapture.stop();

    /**
     * **Whether it arrived warm is `HMR Sink Warm`**, in its own file, because
     * that is a `hmr-warm` claim and this contract does not require one.
     *
     * Asserted here, it failed `rsbuild-vanilla-basic` and `rsbuild-svelte-basic`
     * on their first run — both reload for *every* edit, which L-063 measured,
     * named and gave a capability to. That is the host and framework behaving as
     * documented, not a §4.1 violation. `hmr` says an edit reaches the browser;
     * `hmr-warm` says how.
     */

    /**
     * The new key reached a catalog, so a translator can find it (ledger L-066).
     *
     * A sink that renders and never lands in a catalog is untranslatable, and
     * **invisible to every visual assertion in this suite** — the page is
     * correct in the source locale, which is precisely the state Zintl's
     * no-fallback rule exists to make impossible everywhere else.
     *
     * This claim was asserted once, failed, and was removed rather than tuned.
     * The only way to ask it then was to poll a file for a while and give up,
     * and ZDB §9.3 is explicit that a timing heuristic may exist as a declared
     * fallback and never on a success path. It behaved exactly as that rule
     * predicts: green on `react-basic` in isolation, red on the same project
     * under four-worker contention, with the budget deciding the verdict rather
     * than the behaviour.
     *
     * What brings it back is the **causal** signal it said it needed.
     * `catalogContains` now drives the compiler's own flush to quiescence
     * first — looping on the dirty set, so it terminates because there is no
     * work left rather than because time passed. Nothing here is waited for on
     * a clock.
     *
     * The locale is a non-source one deliberately: the source locale is
     * ghosted and never written to disk, so asking for it would assert the
     * absence of a file the compiler is designed not to produce. No value is
     * asserted — a newly extracted key is written empty until someone
     * translates it, and "the translator can find it" is the whole claim.
     */
    if (addSink.expectText) {
      await lab.assert.catalogContains({
        locale: catalogLocale(lab),
        key: addSink.expectText,
      });
    }
  },
};

executeContract(hmrSinkContract, allManifests);
