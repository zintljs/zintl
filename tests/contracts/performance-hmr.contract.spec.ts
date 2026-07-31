import { expect } from "vite-plus/test";
import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Wall-clock HMR propagation, measured end-to-end through a real browser.
 *
 * On developer hardware this is a tight regression check. Shared CI runners have
 * a far higher noise floor — an unchanged pipeline measured 404-534ms there — so
 * the budget is relaxed under CI to catch only catastrophic regressions. A tight
 * budget on shared hardware does not measure Zintl; it measures the runner, and
 * a suite that cries wolf is a suite everyone learns to ignore.
 *
 * The meaningful number is the local one. Treat a CI failure here as "something
 * is badly wrong", and `vpr bench` as the real performance signal.
 */
const BUDGET_MS = process.env.CI ? 1500 : 350;

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

    const heading = lab.page.locator(adapter.headingSelector);
    await heading.first().waitFor({ state: "visible", timeout: 10000 });
    expect(await heading.first().textContent()).toContain("Perf HMR Works!");

    const duration = performance.now() - start;

    expect(duration).toBeLessThan(BUDGET_MS);
  },
};

executeContract(performanceHmrContract, allManifests);
