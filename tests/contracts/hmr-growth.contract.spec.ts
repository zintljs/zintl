import { executeContract, type Contract, type HmrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { boundaryCount, insert } from "./structural-edit.js";

/**
 * §4.2 — a structural change takes whichever route the entry *and the host* allow.
 *
 * The other side of the line `hmr-sink.contract.spec.ts` opens. Adding a sink
 * puts new content inside a boundary that already exists; adding an anchor or a
 * `$L` colony changes the graph's *shape*. The invariant is that the runtime
 * must not be left holding a boundary map describing the previous build — and
 * §4.2 admits two correct ways to reach it, chosen by the entry rather than by
 * the kind of change.
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
 * The edit is adapter-declared: *where* an anchor can go is framework syntax,
 * and a contract that synthesised it would be naming apps again.
 *
 * Keeping §4.2 in its own contract is not cosmetic: sharing one test with the
 * sink work, `vue-basic` exhausted its 45-second cap under four-worker
 * contention. Three assertions that can each be made independently were sharing
 * one budget, and the §4.2 route assertion is the one that has to spend time
 * proving a reload *did not* happen. Sharing one *file* had the same shape one
 * level up, and was undone the same way — see `hmr-sink.contract.spec.ts`.
 */
export const hmrGrowthContract: Contract<HmrAdapter> = {
  name: "HMR Growth",
  description: "Verifies a new anchor grows the graph and takes the structural route it is allowed",
  requires: ["hmr", "hmr-structural"],
  async execute(lab, adapter) {
    const { addAnchor } = adapter;
    if (!addAnchor) {
      throw new Error(
        `This project claims "hmr-structural" without declaring "addAnchor". The capability is ` +
          `exactly the claim that it can describe that edit.`,
      );
    }

    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    // ──────────────────────────────────────────────────────────────────
    // §4.2 — a new anchor or colony is the structural path
    // ──────────────────────────────────────────────────────────────────

    /**
     * Which of §4.2's two routes is correct here is a **compiler fact**, asked
     * of the compiler rather than declared by the manifest.
     *
     * `entryReexecutionSafe` alone was believed to be the whole of it, and
     * extending this contract past its two original projects found the missing
     * half on the first run. A new anchor is a new boundary, a new boundary is a
     * new catalog chunk, and on Rspack a changed entrypoint chunk set is a full
     * reload the dev server sends before Zintl is consulted — measured, with
     * `plan.fullReload` false for exactly the edits that reload (ledger L-074).
     * `absorbsStructuralChange` composes both, each resolved where it belongs:
     * the framework's half in a runtime facet, the host's in a bundler facet.
     */
    const reexecutionSafe = lab.compiler.absorbsStructuralChange;
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
     * check in `HMR Sink` is: observation and delivery are different events.
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
     *
     * **Both routes wait, and a negative control is why.** The wait used to run
     * only where a reload was expected, so each arm looked for exactly as long
     * as it needed to see what it predicted — and inverting the route predicate
     * outright still passed every project. An assertion whose arms observe for
     * different durations compares the budgets, not the routes. Inverted now,
     * it fails 8 of 8.
     */
    const reloadDeadline = Date.now() + 4_000;
    while (
      !hardCapture.packets.some((p) => p.type === "full-reload") &&
      Date.now() < reloadDeadline
    ) {
      await lab.clock.tick(200);
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

executeContract(hmrGrowthContract, allManifests);
