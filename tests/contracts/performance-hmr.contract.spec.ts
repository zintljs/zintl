import { expect } from "vite-plus/test";
import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Wall-clock HMR propagation, measured end-to-end through a real browser.
 *
 * Relaxed whenever the measurement cannot be trusted: on shared CI runners (an
 * unchanged pipeline measured 404-534ms there) and whenever sibling workers are
 * competing for the same machine. In both cases a tight budget measures the
 * hardware, not Zintl, and a suite that cries wolf is one everyone learns to
 * ignore.
 *
 * The meaningful number is the local one. Treat a CI failure here as "something
 * is badly wrong", and `vpr bench` as the real performance signal.
 */
/**
 * TODO: make this measure Zintl rather than the machine.
 *
 * The budget is already relaxed 4x under CI or parallel workers, which is an
 * admission that the number is about the hardware. In practice it is the single
 * most frequent false red in the suite: it failed repeatedly during a long
 * session at 1,893-3,689ms against a 1,500ms budget while passing 5/5 in
 * isolation, and every one of those was the machine being busy.
 *
 * An absolute wall-clock budget cannot survive that, and it gets *less*
 * meaningful as examples are added, not more — more workers, more contention,
 * wider spread.
 *
 * The fix is to measure a **ratio against a same-run baseline**: time a no-op
 * mutation (one that changes no extractable string) in the same lab, then time
 * the real edit, and assert the second is within some multiple of the first.
 * That cancels machine speed and load out of the measurement, which is exactly
 * what an absolute threshold cannot do.
 *
 * Until then, treat a failure here as "look at `vpr bench`", not as a defect.
 */
const BUDGET_MS = process.env.CI || process.env.ZINTL_PARALLEL ? 1500 : 350;

export const performanceHmrContract: Contract = {
  name: "Performance HMR",
  description: `Verifies E2E HMR propagation finishes and renders in the DOM in under ${BUDGET_MS}ms`,
  requires: ["spa", "hmr", "performance"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const start = performance.now();

    await lab.fs.edit(adapter.headingFile, (content) => {
      return content.replace(adapter.initialHeadingText, "Perf HMR Works!");
    });

    await lab.assert.textEventually(adapter.headingSelector, "Perf HMR Works!");

    const duration = performance.now() - start;

    expect(duration).toBeLessThan(BUDGET_MS);
  },
};

executeContract(performanceHmrContract, allManifests);
