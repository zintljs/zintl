import { expect } from "vite-plus/test";
import { executeContract, type Contract } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const memoryLeakContract: Contract = {
  name: "Memory Leak",
  description: "Verifies the JS heap size remains stable and does not leak after 20 HMR iterations",
  requires: ["spa", "hmr", "memory"],
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
    const heading = lab.page.locator(adapter.headingSelector);
    for (let i = 0; i < 20; i++) {
      await lab.fs.edit(adapter.headingFile, (content) => {
        const target = i === 0 ? adapter.initialHeadingText : `Memory Iteration ${i - 1}`;
        if (!content.includes(target)) {
          throw new Error(`Target text "${target}" not found during memory iteration ${i}`);
        }
        return content.replace(target, `Memory Iteration ${i}`);
      });

      await heading.first().waitFor({ state: "visible", timeout: 10000 });
      expect(await heading.first().textContent()).toContain(`Memory Iteration ${i}`);
    }

    // 4. Trigger garbage collection and verify heap growth
    await session.send("HeapProfiler.collectGarbage");
    const endHeap = await getHeapSize();

    const leak = endHeap - baseline;

    // Fail if memory grows by more than 2.5 MB (indicates unbounded leakage of compiler/hot module states)
    expect(leak).toBeLessThan(2.5 * 1024 * 1024);

    // 5. Clean up CDP session
    await session.detach();
  },
};

executeContract(memoryLeakContract, allManifests);
