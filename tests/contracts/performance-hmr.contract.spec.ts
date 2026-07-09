import { expect } from "@playwright/test";
import { executeContract, type Contract } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const performanceHmrContract: Contract = {
  name: "Performance HMR",
  description: "Verifies E2E HMR propagation finishes and renders in the DOM in under 350ms",
  requires: ["spa", "hmr", "performance"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const start = performance.now();

    await lab.fs.edit(adapter.headingFile, (content) => {
      return content.replace(adapter.initialHeadingText, "Perf HMR Works!");
    });

    const heading = lab.page.locator(adapter.headingSelector);
    await expect(heading.first()).toContainText("Perf HMR Works!", { timeout: 10000 });

    const duration = performance.now() - start;

    // Fail if propagation duration exceeds 350ms (regression check)
    expect(duration).toBeLessThan(350);
  },
};

executeContract(performanceHmrContract, allManifests);
