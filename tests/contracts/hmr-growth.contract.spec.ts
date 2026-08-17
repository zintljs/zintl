import {
  executeContract,
  findCatalogFor,
  type Contract,
  type HmrAdapter,
  type Lab,
  type SourceInsertion,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * The graph grows, and the update mechanism changes with it (ZHMR §4.1③, §4.2).
 *
 * Every other hot-update contract edits a string that already exists. That is
 * the easy half of the specification: nothing about the boundary graph moves,
 * so one mechanism serves the whole run. ZHMR draws its sharpest line somewhere
 * else — between a change that *fits* the existing graph and one that reshapes
 * it — and puts different machinery on each side:
 *
 * - **§4.1③, adding a sink.** New content inside a boundary that already
 *   exists. Fast Replacement: the manager accepts in place, and a new key has
 *   to reach the catalog on disk for a translator to find.
 * - **§4.2, adding an anchor or a `$L` colony.** The graph's *shape* changed, so
 *   in-place replacement is not merely slower but wrong — the module that would
 *   accept the update is no longer the module that owns the code. A full reload
 *   is the correct outcome.
 *
 * The two hosts reach §4.2 by opposite routes, which is the reason to assert
 * the observable rather than the mechanism: **Vite** accepts and then calls
 * `import.meta.hot.invalidate()` so the update bubbles; **Rspack** has no
 * `invalidate()` and instead declines to accept at all, so the update bubbles
 * for want of a handler. Same reload, opposite code paths, and a contract
 * written against either one would have been a contract about a bundler.
 *
 * Both edits are adapter-declared: *where* a sink or an anchor can go is
 * framework syntax, and a contract that synthesised it would be naming apps
 * again.
 */
export const hmrGrowthContract: Contract<HmrAdapter> = {
  name: "HMR Growth",
  description:
    "Verifies adding a sink hot-replaces while adding an anchor or colony reloads instead",
  requires: ["hmr", "hmr-structural"],
  /**
   * **The warm half passes; the structural half found a spec/implementation
   * disagreement rather than a bug.**
   *
   * Adding a sink hot-replaces correctly on both projects, and the new key does
   * reach the catalog on disk — though not before the DOM, which is why the
   * check below is polled.
   *
   * Adding a nested `zintl()` anchor produces a single `update` packet and **no
   * reload**, and the page is fine afterwards. ZHMR §4.2 says a new anchor is
   * the structural path and must reload. The implementation disagrees on
   * purpose: where the entry is re-execution-safe — a framework declaring
   * client reactivity — Vite emits a self-accepting snippet and the
   * re-executed entry picks the new boundary up in place. Measured on
   * `react-basic` and `vanilla-spa-basic`; the final reload-and-recheck in the
   * body confirms the runtime is not left holding a stale boundary map.
   *
   * So one of the two is wrong, and which is a product decision rather than a
   * test one: either §4.2 should say "reload *unless* the entry is
   * re-execution-safe", or the compiler should force the reload it specifies.
   * Left pending with the measurement rather than quietly relaxed to whatever
   * the code happens to do — a contract rewritten to match the implementation
   * stops being able to disagree with it.
   */
  pendingFor: {
    "react-basic":
      "ZHMR §4.2 vs implementation: adding a nested zintl() anchor emits `update`, not " +
      "`full-reload`, and the page stays correct. Re-execution-safe entries self-accept. " +
      "Spec or code must move; no product fix attempted.",
    "vanilla-spa-basic":
      "Same as react-basic: one `update` packet, no reload, page correct afterwards.",
  },
  async execute(lab, adapter) {
    const { addSink, addAnchor } = adapter;
    if (!addSink || !addAnchor) {
      throw new Error(
        `This project claims "hmr-structural" without declaring both "addSink" and "addAnchor". ` +
          `The capability is exactly the claim that it can describe those two edits.`,
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

    const warmPackets = warmCapture.stop();
    if (warmPackets.some((p) => p.type === "full-reload")) {
      throw new Error(
        `Adding a sink to ${addSink.file} reloaded the page. ZHMR §4.1 lists "a sink is added ` +
          `or removed without changing the boundary hierarchy" among the Fast Replacement ` +
          `triggers — the boundary already exists, so only its content changed.\n\n` +
          `Packets: ${warmPackets.map((p) => p.type).join(", ")}`,
      );
    }

    /**
     * The new string reached disk, where a translator works.
     *
     * A sink that renders but never lands in a catalog is the failure this
     * catches: the page looks right in the source locale and the string is
     * untranslatable, which nothing visual would reveal.
     *
     * **Polled, not read once.** The DOM update and the catalog write are not
     * the same event — the first arrives over the HMR channel, the second is a
     * `flush()` the compiler coalesces, and the delivery ledger shows it
     * routinely landing as `flush #N → superseded (dirt retained for the
     * next)`. Reading immediately after `textEventually` therefore measures
     * scheduling rather than behaviour. The budget is what distinguishes "the
     * flush had not happened yet" from "the flush will never happen without
     * another edit", which is the failure worth having.
     */
    if (addSink.expectText) {
      const deadline = Date.now() + 8_000;
      let probe = findCatalogFor(lab, { locale: "es", key: addSink.expectText });
      while (probe.ok && !probe.carriesKey && Date.now() < deadline) {
        await lab.clock.tick(250);
        probe = findCatalogFor(lab, { locale: "es", key: addSink.expectText });
      }
      if (probe.ok && !probe.carriesKey) {
        throw new Error(
          `The new sink ${JSON.stringify(addSink.expectText)} rendered, but 8s later no catalog ` +
            `for "es" carries it. Nearest is ${probe.path} with ${probe.keys.length} key(s). A ` +
            `string that renders and cannot be translated is invisible to every visual ` +
            `assertion, and to the translator whose job it is to find it.`,
        );
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // §4.2 — a new anchor or colony is the structural path
    // ──────────────────────────────────────────────────────────────────
    const hardCapture = lab.ws.capture();
    await insert(lab, addAnchor, "addAnchor");

    const hardPackets = hardCapture.stop();
    if (!hardPackets.some((p) => p.type === "full-reload")) {
      throw new Error(
        `Adding an anchor or colony to ${addAnchor.file} did not reload the page — saw ` +
          `${hardPackets.length} packet(s): ${hardPackets.map((p) => p.type).join(", ") || "(none)"}.\n\n` +
          `ZHMR §4.2: once the graph's shape changes, the module that would accept the update ` +
          `is no longer the module that owns the code, so replacing in place leaves the runtime ` +
          `holding a boundary map that describes the previous build.\n\n` +
          (await lab.assert.describeStall()),
      );
    }

    /**
     * Whatever route it took, the app must still be an app afterwards.
     *
     * A reload that leaves the page blank satisfies the packet assertion above
     * and is a worse outcome than no reload at all — Zintl has no
     * source-locale fallback, so a boundary map that no longer matches the
     * graph renders every key as an empty string.
     */
    await lab.page.reload();
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);
  },
};

async function insert(lab: Lab, edit: SourceInsertion, which: string): Promise<void> {
  await lab.fs.edit(edit.file, (content) => {
    const at = content.indexOf(edit.anchorOn);
    if (at === -1) {
      throw new Error(
        `${which} anchors on ${JSON.stringify(edit.anchorOn)}, which is not in ${edit.file}. ` +
          `The adapter has drifted from the project it describes.`,
      );
    }
    const cut = at + edit.anchorOn.length;
    return content.slice(0, cut) + edit.insert + content.slice(cut);
  });
}

executeContract(hmrGrowthContract, allManifests);
