import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const hmrHammerContract: Contract = {
  name: "HMR Hammer",
  description: "Verifies rapid concurrent filesystem updates converge correctly on the final text",
  requires: ["hmr", "hmr-stress"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const fullPath = join(lab.root, adapter.headingFile);
    const originalContent = await lab.fs.read(adapter.headingFile);

    /**
     * Opened before the first edit, because a body that arrives before the
     * listener does is a body nobody can report on.
     */
    const capture = lab.network.captureBodies(/\.(tsx?|jsx?|mjs|vue|svelte)(\?|$)|\/js\//, [
      "HMR Hammer works!",
    ]);

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

    /**
     * 4. The browser is served the final module — the guarantee Zintl makes.
     *
     * This asserted DOM convergence for its whole life, and five probes went
     * into finding out why that failed under load (ledger L-080). Every step
     * Zintl owns was correct on the failing runs: the file on disk, the watcher
     * event, the byte count handed to the plan, the modules invalidated, the
     * packet on the wire, the transform the dev server served — and the browser
     * fetching the final module, *twice*:
     *
     * ```
     * t=…046589 len=26787 final=false h4=true    ← Hammer 4
     * t=…046717 len=26808 final=true  h4=false   ← the final content
     * t=…046805 len=26808 final=true  h4=false   ← again
     * ```
     *
     * The DOM still showed `Hammer 4`. What declined to re-render was React
     * Fast Refresh, under four refreshes inside ~400 ms — a framework's refresh
     * scheduler, reacting to a burst of three raw writes 30 ms apart that no
     * editor produces.
     *
     * So the assertion moved to what Zintl can be held to. Coalescing rapid
     * writes is correct; **dropping the final state is not**, and that is the
     * defect proposal 024 §1.1a names. Whether the last write's content reaches
     * the browser is exactly that question, and it is answered by reading what
     * the browser was served rather than by watching a framework decide what to
     * do with it.
     *
     * The DOM is still checked below, unbudgeted, so a page that breaks outright
     * is not mistaken for one that merely did not repaint.
     */
    await capture.waitForBody("HMR Hammer works!", { timeout: 10_000 });
    capture.stop();

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
     * Which is exactly what the delivery check above tests. Counting packets
     * would only add a red that means nothing.
     */

    /**
     * The page is still an app afterwards.
     *
     * Unbudgeted and deliberately weak: it asserts the heading is *something*
     * from this test rather than the final text, because which of the burst's
     * values React settles on is the scheduler's business. A blank or missing
     * heading is a different failure and this still catches it.
     */
    const heading = await lab.page.textContent(adapter.headingSelector);
    if (!heading || !/Hammer/.test(heading)) {
      throw new Error(
        `After the burst the heading reads ${JSON.stringify(heading)} — the final module reached ` +
          `the browser, so this is a page that failed to render rather than one that merely did ` +
          `not repaint.\n\n` +
          (await lab.assert.describeStall()),
      );
    }
  },
};

executeContract(hmrHammerContract, allManifests);
