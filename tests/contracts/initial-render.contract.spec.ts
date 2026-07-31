import { expect } from "vite-plus/test";
import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const initialRenderContract: Contract = {
  name: "Initial Render",
  description:
    "Verifies that the SPA starts and displays the correct initial heading in the source locale",
  requires: ["spa"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    const heading = lab.page.locator(adapter.headingSelector);
    await heading.waitFor({ state: "visible", timeout: 10000 });
    expect(await heading.textContent()).toContain(adapter.initialHeadingText);
  },
};

executeContract(initialRenderContract, allManifests);
