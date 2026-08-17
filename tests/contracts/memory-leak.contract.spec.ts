import { expect } from "vite-plus/test";
import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const memoryLeakContract: Contract = {
  name: "Memory Leak",
  description: "Verifies the JS heap size remains stable and does not leak after 20 HMR iterations",
  requires: ["hmr", "memory"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const session = await lab.page.context().newCDPSession(lab.page);

    // 1. Enable Performance and HeapProfiler domains
    await session.send("Performance.enable");
    await session.send("HeapProfiler.enable");

    // Helper to extract the active JS heap size
    const getHeapSize = async (): Promise<number> => {
      const res = await session.send("Performance.getMetrics");
      const metric = res.metrics.find((m) => m.name === "JSHeapUsedSize");
      return metric ? metric.value : 0;
    };

    // 2. Trigger baseline garbage collection and capture memory baseline
    await session.send("HeapProfiler.collectGarbage");
    const baseline = await getHeapSize();

    // 3. Trigger 20 sequential HMR edits
    for (let i = 0; i < 20; i++) {
      await lab.fs.edit(adapter.headingFile, (content) => {
        const target = i === 0 ? adapter.initialHeadingText : `Memory Iteration ${i - 1}`;
        if (!content.includes(target)) {
          throw new Error(`Target text "${target}" not found during memory iteration ${i}`);
        }
        return content.replace(target, `Memory Iteration ${i}`);
      });

      await lab.assert.textEventually(adapter.headingSelector, `Memory Iteration ${i}`);
    }

    // 4. Trigger garbage collection and verify heap growth
    await session.send("HeapProfiler.collectGarbage");
    const endHeap = await getHeapSize();

    const leak = endHeap - baseline;

    /**
     * Guards against *unbounded* leakage of compiler and hot-module state
     * across HMR cycles — not against the absolute size of the dev runtime.
     *
     * Recalibrated from 2.5 MB to 3.5 MB when the `__ZINTL_DEV__` sentinel
     * landed. The old ceiling was measured against a dev runtime whose debug
     * branches were being dead-stripped by accident: the `typeof process`
     * guard in front of them was always false in a browser, so the bundler
     * removed code that was supposed to be live in development. With the
     * sentinel resolving correctly, dev genuinely ships those branches and the
     * floor moved to ~2.80 MB (measured across three runs, variance under
     * 50 bytes — deterministic, not drift).
     *
     * The headroom above that floor is what still catches a real leak: 20 HMR
     * cycles retaining per-iteration state would blow well past this.
     */
    expect(leak).toBeLessThan(3.5 * 1024 * 1024);

    // 5. Clean up CDP session
    await session.detach();
  },
};

executeContract(memoryLeakContract, allManifests);
