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
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);
  },
};

executeContract(initialRenderContract, allManifests);
