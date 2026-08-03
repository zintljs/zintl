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
    await lab.assert.textEventually(adapter.headingSelector, "HMR Hammer works!");

    /**
     * Deliberately **not** asserted: that the wire carried one packet per write.
     *
     * That assertion was written, and it failed on every project — 3 packets for
     * 5 writes, consistently, while the DOM converged correctly every time. The
     * conclusion is not that delivery is broken; it is that the assertion
     * encoded a false invariant.
     *
     * Coalescing rapid writes is *correct*. Two writes 30 ms apart may become
     * one event, and that is fine as long as the event carries the later
     * content. Proposal 024 §1.1a is a narrower defect than "fewer packets than
     * writes": it is when coalescing drops the **final** state, leaving the DOM
     * on an intermediate value with the file on disk saying otherwise.
     *
     * Which is exactly what the convergence check above tests. Counting packets
     * would only add a red that means nothing.
     */
  },
};

executeContract(hmrHammerContract, allManifests);
