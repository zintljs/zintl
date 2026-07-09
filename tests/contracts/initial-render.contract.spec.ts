import { expect } from "@playwright/test";
import { executeContract, type Contract } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const initialRenderContract: Contract = {
  name: "Initial Render",
  description:
    "Verifies that the SPA starts and displays the correct initial heading in the source locale",
  requires: ["spa"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await expect(lab.page.locator(adapter.headingSelector)).toContainText(
      adapter.initialHeadingText,
      { timeout: 10000 },
    );
  },
};

executeContract(initialRenderContract, allManifests);
