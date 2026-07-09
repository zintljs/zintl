import { expect } from "@playwright/test";
import { executeContract, type Contract } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const syntaxRecoveryContract: Contract = {
  name: "Syntax Error Recovery",
  description:
    "Verifies HMR recovers cleanly without manual refresh after fixing compilation errors",
  requires: ["spa", "hmr"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    // 1. Verify initial text
    const heading = lab.page.locator(adapter.headingSelector);
    await expect(heading).toContainText(adapter.initialHeadingText, { timeout: 10000 });

    // 2. Introduce a syntax error at the bottom of the file
    const syntaxErrorToken = "\nconst syntaxErrorToken = ;";
    await lab.fs.edit(adapter.headingFile, (content) => content + syntaxErrorToken);

    // Wait a brief moment for Vite compile cycle to process and log the error
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 3. Recover by removing the error and changing the heading
    await lab.fs.edit(adapter.headingFile, (content) => {
      let recovered = content.replace(syntaxErrorToken, "");
      return recovered.replace(adapter.initialHeadingText, "Recovered!");
    });

    // 4. Assert that the heading successfully updated to "Recovered!" after recovery
    await expect(heading).toContainText("Recovered!", { timeout: 15000 });
  },
};

executeContract(syntaxRecoveryContract, allManifests);
