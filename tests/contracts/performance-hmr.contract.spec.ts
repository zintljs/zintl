import { executeContract, type Contract, type HmrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * How much slower a hot update is *because of Zintl* — measured as a ratio, in
 * the same lab, on the same machine, seconds apart.
 *
 * **This asserted an absolute wall clock for its whole life, and the wall clock
 * was measuring the hardware.** The budget was already relaxed 4× under CI or
 * parallel workers, which is the admission: 350 ms locally, 1,500 ms when
 * anything else is running. It was the single most frequent false red in the
 * suite — 1,893-3,689 ms against a 1,500 ms budget during one busy session,
 * passing 5 of 5 in isolation immediately after — and every one of those was a
 * busy machine rather than a defect. An absolute threshold gets *less*
 * meaningful as the suite grows, not more: more examples, more workers, wider
 * spread.
 *
 * A ratio cancels the machine out of the measurement. Two edits to the same
 * file, in the same lab, moments apart:
 *
 * - **Baseline** — the adapter's `perfNoopEdit`, a comment inside the file's
 *   script region. The file changes, so the host re-reads it, re-transforms it
 *   and pushes an update; **no extractable string changes**, so Zintl has
 *   nothing to reconcile, no catalog to write and nothing to deliver. That is
 *   the host's own round trip, priced today, on this machine, under this load.
 * - **Treatment** — change the heading. Same round trip plus everything Zintl
 *   does for a string that actually moved.
 *
 * Both are timed to the **same observable**: the `update` packet reaching the
 * browser. Timing one to a packet and the other to the DOM would put render
 * time on only one side of the ratio, which is the same asymmetry that made
 * `hmr-growth`'s route assertion vacuous — there, each branch chose its own
 * observation budget and therefore saw what it predicted.
 *
 * The DOM assertion stays, unbudgeted, because "it renders" is still worth
 * proving; it is simply not what is being timed.
 *
 * **The baseline is declared, not synthesised, and one measurement is why.**
 * Appending a trailing newline looked universal — a real content change to
 * every host, a no-op to every parser — and it is *nothing at all* to an SFC:
 * content outside `<script>` and `<template>` never reaches the compiler, so
 * `vue-basic` produced no update packet in ten seconds while the other three
 * projects produced one immediately. Where a no-op may legally go is a property
 * of the dialect, so the manifest says it.
 */

/**
 * How many times the host's own round trip Zintl may cost on top of it.
 *
 * Deliberately loose. The question this contract can answer honestly is "did
 * Zintl's share of a hot update change by an order of magnitude", not "is it
 * fast" — `vpr bench` owns that, against recorded baselines, on a machine doing
 * nothing else. A ratio measured once per run on a contended box carries real
 * spread, and a tight multiplier here would recreate the false red this rewrite
 * exists to remove.
 *
 * Measured warm, across the four claimants: **1.2×, 1.2×, 1.3×, 2.0×**, with
 * treatments a steady 95-102 ms against baselines of 50-83 ms. Six times plus
 * the floor leaves roughly eight times the observed cost, which is the room a
 * once-per-run sample on a shared machine needs.
 */
const MAX_RATIO = 6;

/**
 * Added to the allowance so a very fast baseline cannot make the ratio absurd.
 *
 * When the host's round trip is 20 ms, six times it is 120 ms, and a scheduler
 * hiccup alone can cost more than that. The floor is what keeps the assertion
 * about Zintl instead of about which side of a GC pause each measurement fell.
 */
const FLOOR_MS = 400;

export const performanceHmrContract: Contract<HmrAdapter> = {
  name: "Performance HMR",
  description: "Verifies Zintl's share of a hot update stays proportionate to the host's own",
  /**
   * `hmr-warm`, because a project that reloads is not timing a hot update.
   *
   * Extending `performance` to Rspack put `rsbuild-vanilla-basic` and
   * `rsbuild-svelte-basic` in scope, and both exhausted the 45-second cap: on
   * that host neither hot-replaces, so all three edits here become full page
   * reloads and the ratio compares two navigations. L-063 created `hmr-warm`
   * for exactly this distinction — `hmr` says an edit reaches the browser,
   * `hmr-warm` says it does so without discarding the page — and the two
   * projects still claim `performance`, so `performance-size` measures them.
   */
  requires: ["hmr", "hmr-warm", "performance"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    const noop = adapter.perfNoopEdit;
    if (!noop) {
      throw new Error(
        `This project claims "performance" without declaring "perfNoopEdit". The baseline is ` +
          `what makes this measurement about Zintl rather than about the machine, and which edit ` +
          `changes a file without changing a translatable string is a per-dialect fact.`,
      );
    }

    /**
     * One untimed no-op first, because the **first** edit in a lab is not a
     * round trip like the others.
     *
     * Measured without it, the baseline ran 49-182 ms while the treatment ran a
     * steady 95-101 ms across all four projects — ratios of 0.5× to 2.1×, and
     * the treatment *faster* than its own baseline on two of them. That is not
     * Zintl being quicker than the host; it is the first edit paying for the
     * first re-transform, the first watcher batch and the first update the
     * client has ever applied. Comparing a cold measurement with a warm one
     * measures the order they were taken in.
     */
    await applyNoop(lab, noop);

    const baseline = await timeUpdate(lab, () =>
      lab.fs.edit(noop.file, (content) => {
        const at = content.indexOf(noop.anchorOn);
        if (at === -1) {
          throw new Error(
            `perfNoopEdit anchors on ${JSON.stringify(noop.anchorOn)}, which is not in ` +
              `${noop.file}. The adapter has drifted from the project it describes.`,
          );
        }
        const cut = at + noop.anchorOn.length;
        return content.slice(0, cut) + noop.insert + content.slice(cut);
      }),
    );

    const treatment = await timeUpdate(lab, () =>
      lab.fs.edit(adapter.headingFile, (content) =>
        content.replace(adapter.initialHeadingText, "Perf HMR Works!"),
      ),
    );

    // Unbudgeted, and still the point of the whole exchange.
    await lab.assert.textEventually(adapter.headingSelector, "Perf HMR Works!");

    if (baseline === undefined || treatment === undefined) {
      throw new Error(
        `No \`update\` packet reached the browser for one of the two edits — baseline ` +
          `${describe(baseline)}, treatment ${describe(treatment)}. Without both there is no ` +
          `ratio to take, and an edit that produces no update at all is a hot-update failure ` +
          `rather than a performance one.`,
      );
    }

    const allowance = baseline * MAX_RATIO + FLOOR_MS;
    if (treatment > allowance) {
      throw new Error(
        `Zintl's hot update took ${treatment.toFixed(0)}ms against a host round trip of ` +
          `${baseline.toFixed(0)}ms measured moments earlier in the same lab — ` +
          `${(treatment / baseline).toFixed(1)}×, past the allowance of ${allowance.toFixed(0)}ms ` +
          `(${MAX_RATIO}× + ${FLOOR_MS}ms).\n\n` +
          `Both numbers were taken on this machine under this load, so a busy box inflates them ` +
          `together and cancels. A ratio this far out is Zintl's share of the work, not the ` +
          `hardware's.\n\n` +
          (await lab.assert.describeStall()),
      );
    }
  },
};

/** Apply the declared no-op once, without timing it. */
async function applyNoop(lab: any, noop: { file: string; anchorOn: string; insert: string }) {
  await lab.fs.edit(noop.file, (content: string) => {
    const at = content.indexOf(noop.anchorOn);
    if (at === -1) {
      throw new Error(
        `perfNoopEdit anchors on ${JSON.stringify(noop.anchorOn)}, which is not in ${noop.file}. ` +
          `The adapter has drifted from the project it describes.`,
      );
    }
    const cut = at + noop.anchorOn.length;
    return content.slice(0, cut) + noop.insert + content.slice(cut);
  });
  await lab.clock.waitForIdle();
}

/** How long until the host pushed an update for the edit `mutate` makes. */
async function timeUpdate(lab: any, mutate: () => Promise<void>): Promise<number | undefined> {
  const capture = lab.ws.capture();
  const start = performance.now();
  await mutate();

  const deadline = Date.now() + 10_000;
  while (
    !capture.packets.some((p: { type: string }) => p.type === "update" || p.type === "full-reload")
  ) {
    if (Date.now() > deadline) {
      capture.stop();
      return undefined;
    }
    await lab.clock.tick(10);
  }

  const elapsed = performance.now() - start;
  capture.stop();
  return elapsed;
}

function describe(value: number | undefined): string {
  return value === undefined ? "(none within 10s)" : `${value.toFixed(0)}ms`;
}

executeContract(performanceHmrContract, allManifests);
