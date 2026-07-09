import { expect } from "@playwright/test";
import { executeContract, type Contract, type SsrAdapter } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const hydrationContract: Contract<SsrAdapter> = {
  name: "SSR Hydration",
  description:
    "Verifies that SSR HTML contains content before JS and hydrates without console mismatch errors",
  requires: ["ssr"],
  async execute(lab, adapter) {
    const enSsrPath = adapter.ssrPath("en");

    // 1. Warm-up request to trigger compilation and populate catalog graph
    try {
      await fetch(`${lab.url}${enSsrPath}`);
    } catch {
      // Ignored for raw network level issues, but let's allow it to warm up.
    }

    // 2. Second request: fetch raw HTML and check it contains the translated/source text
    const res = await fetch(`${lab.url}${enSsrPath}`);
    const html = await res.text();
    expect(html).toContain(adapter.initialHeadingText);

    // 3. Browser navigation to verify post-hydration and console log errors
    await lab.page.goto(`${lab.url}${enSsrPath}`);
    await lab.clock.waitForIdle();

    // 4. Assert no hydration mismatch console errors occurred
    const consoleErrors = lab.console.errors;
    const hydrationErrors = consoleErrors.filter(
      (e) =>
        e.text.toLowerCase().includes("hydration") || e.text.toLowerCase().includes("mismatch"),
    );
    if (hydrationErrors.length > 0) {
      throw new Error(
        `Hydration errors found in console:\n` +
          hydrationErrors.map((e) => `[${e.type}] ${e.text}`).join("\n"),
      );
    }

    // 5. Assert the visual heading exists and is correct after hydration
    const heading = lab.page.locator(adapter.headingSelector);
    await expect(heading).toContainText(adapter.initialHeadingText, { timeout: 10000 });
  },
};

executeContract(hydrationContract, allManifests);
