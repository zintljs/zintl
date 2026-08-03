import { expect } from "vite-plus/test";
import { executeContract, type Contract, type HmrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const hmrContract: Contract<HmrAdapter> = {
  name: "HMR Propagation",
  description:
    "Verifies that edits to translatable source strings propagate to the browser via HMR",
  requires: ["spa", "hmr"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    // 1. Verify initial text
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    // 2. Perform a smart filesystem mutation
    await lab.fs.edit(adapter.headingFile, (content) => {
      if (!content.includes(adapter.initialHeadingText)) {
        throw new Error(
          `Heading text "${adapter.initialHeadingText}" not found in file: ${adapter.headingFile}`,
        );
      }
      return content.replace(adapter.initialHeadingText, "HMR works!");
    });

    // 3. Verify that the change was rendered automatically in the browser via HMR
    await lab.assert.textEventually(adapter.headingSelector, "HMR works!");
  },
};

executeContract(hmrContract, allManifests);
