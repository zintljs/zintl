import { expect } from "vite-plus/test";
import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const hmrHammerContract: Contract = {
  name: "HMR Hammer",
  description: "Verifies rapid concurrent filesystem updates converge correctly on the final text",
  requires: ["spa", "hmr-stress"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const fullPath = join(lab.root, adapter.headingFile);
    const originalContent = await lab.fs.read(adapter.headingFile);

    // 1. Perform first standard edit to establish backup
    await lab.fs.edit(adapter.headingFile, (content) =>
      content.replace(adapter.initialHeadingText, "Hammer 1"),
    );

    // 2. Perform rapid intermediate edits directly to filesystem (bypassing propagation wait)
    for (let i = 2; i <= 4; i++) {
      const modified = originalContent.replace(adapter.initialHeadingText, `Hammer ${i}`);
      await writeFile(fullPath, modified, "utf-8");
      // Short delay to simulate back-to-back chokidar events
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    // 3. Perform final standard edit to trigger full propagation wait
    await lab.fs.edit(adapter.headingFile, (content) => {
      // The filesystem currently has "Hammer 4"
      if (!content.includes("Hammer 4")) {
        // Fallback if compilation order differed slightly under load
        return "HMR Hammer works!";
      }
      return content.replace("Hammer 4", "HMR Hammer works!");
    });

    // 4. Assert that the browser eventually converged on the final text
    const heading = lab.page.locator(adapter.headingSelector);
    await heading.waitFor({ state: "visible", timeout: 15000 });
    expect(await heading.textContent()).toContain("HMR Hammer works!");
  },
};

executeContract(hmrHammerContract, allManifests);
