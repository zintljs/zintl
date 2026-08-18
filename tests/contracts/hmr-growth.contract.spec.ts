import {
  executeContract,
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
 * - **§4.2, adding an anchor or a `$L` colony.** The graph's *shape* changed.
 *   The invariant is that the runtime must not be left holding a boundary map
 *   describing the previous build — and §4.2 admits two correct ways to reach
 *   it, chosen by the entry rather than by the kind of change.
 *
 * **This contract is why §4.2 has two routes.** It was written asserting the
 * section as it stood — a structural change always hard-reloads — and found the
 * implementation disagreeing on purpose: on a re-execution-safe entry the change
 * arrived as an ordinary `update`, the graph grew, and the page was correct,
 * confirmed by reloading afterwards and re-asserting. The specification was the
 * thing that was wrong and was amended (§4.2.1/§4.2.2, ledger L-061). The
 * contract now asserts the amended rule, and the branch is taken from
 * `entryReexecutionSafe` — a compiler fact, asked of the compiler, never
 * restated in a manifest.
 *
 * The two hosts reach §4.2.2 by opposite routes, which is why the assertion is
 * on the observable rather than the mechanism: **Vite** accepts and then calls
 * `import.meta.hot.invalidate()` so the update bubbles; **Rspack** has no
 * `invalidate()` and instead declines to accept at all, so it bubbles for want
 * of a handler. Same reload, opposite code paths, and a contract written
 * against either one would have been a contract about a bundler.
 *
 * Both edits are adapter-declared: *where* a sink or an anchor can go is
 * framework syntax, and a contract that synthesised it would be naming apps
 * again.
 */
export const hmrGrowthContract: Contract<HmrAdapter> = {
  name: "HMR Growth",
  description:
    "Verifies a new sink hot-replaces, and a new anchor takes whichever structural route its entry allows",
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

    // ──────────────────────────────────────────────────────────────────
    // §4.2 — a new anchor or colony is the structural path
    // ──────────────────────────────────────────────────────────────────

    /**
     * Which of §4.2's two routes is correct here is a **compiler fact**, asked
     * of the compiler rather than declared by the manifest. `entryReexecutionSafe`
     * is resolved from the framework's runtime facet, and it is the whole of
     * what decides this: §4.2.1 where the entry can be re-run, §4.2.2 where it
     * cannot.
     */
    const reexecutionSafe = lab.compiler.entryReexecutionSafe;
    const boundariesBefore = boundaryCount(lab);

    const hardCapture = lab.ws.capture();
    await insert(lab, addAnchor, "addAnchor");

    /**
     * The graph must actually grow, on **both** routes.
     *
     * This is the assertion that makes the rest meaningful. A reload with no
     * new boundary means the anchor was never observed, and a reload is then
     * just an expensive way to render the same thing — which would satisfy a
     * packet-only check completely. Polled for the same reason the catalog
     * check above is: observation and delivery are different events.
     */
    const growthDeadline = Date.now() + 8_000;
    while (boundaryCount(lab) <= boundariesBefore && Date.now() < growthDeadline) {
      await lab.clock.tick(250);
    }
    const boundariesAfter = boundaryCount(lab);
    if (boundariesAfter <= boundariesBefore) {
      throw new Error(
        `Adding an anchor to ${addAnchor.file} did not grow the boundary graph — still ` +
          `${boundariesAfter} boundaries after 8s. The structural change was never observed, so ` +
          `whatever the browser was told, it was not told about this.\n\n` +
          (await lab.assert.describeStall()),
      );
    }

    /**
     * A reload on this route arrives **after** the update that triggers it, and
     * the gap is a round trip rather than a scheduling accident.
     *
     * Where the entry is not re-execution-safe, `viteFacet` emits
     * `accept(() => import.meta.hot.invalidate())`. So the sequence on the wire
     * is: server sends `update` → the client runs the callback → the client
     * tells the server to invalidate → the server decides it cannot be handled
     * and sends `full-reload`. Stopping the capture as soon as the update lands
     * therefore reads the first packet of a two-packet exchange and concludes
     * the reload never happened. Waited for, bounded, and the absence after the
     * budget is what the §4.2.2 assertion below is entitled to call a failure.
     */
    if (!reexecutionSafe) {
      const reloadDeadline = Date.now() + 4_000;
      while (
        !hardCapture.packets.some((p) => p.type === "full-reload") &&
        Date.now() < reloadDeadline
      ) {
        await lab.clock.tick(200);
      }
    }

    const hardPackets = hardCapture.stop();
    const reloaded = hardPackets.some((p) => p.type === "full-reload");

    if (!reexecutionSafe && !reloaded) {
      throw new Error(
        `ZHMR §4.2.2: this project's entry is not re-execution-safe, so a structural change must ` +
          `bubble to a full reload — but adding an anchor to ${addAnchor.file} produced ` +
          `${hardPackets.length} packet(s): ${hardPackets.map((p) => p.type).join(", ") || "(none)"}.\n\n` +
          `Replacing in place here leaves the runtime holding a boundary map that describes the ` +
          `previous build, and with no source-locale fallback the mismatch renders as empty ` +
          `strings rather than stale ones.\n\n` +
          (await lab.assert.describeStall()),
      );
    }

    if (reexecutionSafe && reloaded) {
      throw new Error(
        `ZHMR §4.2.1: this project's entry is re-execution-safe, so the re-executed entry rebuilds ` +
          `the boundary map and the structural change should be absorbed in place — but the page ` +
          `was reloaded instead, discarding application state to reach a state an update could ` +
          `have reached.\n\n` +
          `Packets: ${hardPackets.map((p) => p.type).join(", ")}`,
      );
    }

    /**
     * Whatever route it took, the app must still be an app afterwards.
     *
     * A reload that leaves the page blank satisfies the packet assertion above
     * and is a worse outcome than no reload at all — Zintl has no
     * source-locale fallback, so a boundary map that no longer matches the
     * graph renders every key as an empty string.
     *
     * **Only reload when the server did not.** On the §4.2.2 route the server
     * has already told the page to navigate, and issuing a second reload into
     * a frame that is mid-navigation fails with `net::ERR_ABORTED; maybe frame
     * was detached?` — a contract racing the very reload it just asserted, and
     * reporting it as a defect in the thing under test.
     */
    if (!reloaded) {
      await lab.page.reload();
    }
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);
  },
};

/**
 * A locale this project actually writes catalogs for.
 *
 * Asked of the compiler rather than declared by the manifest, for the reason
 * L-062 records: `outputDir`, `catalogFormat` and which locales exist are
 * resolved compiler facts, and twenty adapters restating them is how a contract
 * comes to guess at paths the compiler had already worked out. The source
 * locale is excluded because ghost mode never writes it.
 */
function catalogLocale(lab: Lab): string {
  const compiler = lab.compiler.instance as
    | { locales?: string[]; sourceLocale?: string }
    | undefined;
  const target = compiler?.locales?.find((l) => l !== compiler.sourceLocale);
  if (!target) {
    throw new Error(
      `The compiler reports no locale other than the source one, so no catalog is ever ` +
        `written and there is nothing for this assertion to look in.`,
    );
  }
  return target;
}

/** Boundaries the compiler currently knows about, or `-1` if it cannot say. */
function boundaryCount(lab: Lab): number {
  try {
    return lab.compiler.getBoundaryGraph()?.nodes?.size ?? -1;
  } catch {
    return -1;
  }
}

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
