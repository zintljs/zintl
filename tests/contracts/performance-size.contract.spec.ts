import { expect } from "vite-plus/test";
import { executeContract, type Contract, type LocaleSwitchAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const performanceSizeContract: Contract<LocaleSwitchAdapter> = {
  name: "Performance Size",
  description:
    "Verifies dynamically loaded translations chunks stay under a 10KB payload size budget",
  requires: ["spa", "locale-switch", "performance"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const catalogSizes: number[] = [];
    const onResponse = async (res: any) => {
      const url = res.url();
      // Target Zintl dynamic virtual modules or catalog JSON files
      if (
        url.includes("virtual:zintl") ||
        url.includes("/zintl/") ||
        url.includes("/i18n/") ||
        url.endsWith(".json")
      ) {
        try {
          const body = await res.body();
          catalogSizes.push(body.length);
        } catch {
          // Ignore non-readable/aborted responses
        }
      }
    };

    lab.page.on("response", onResponse);

    // Switch locale to Spanish to trigger dynamic catalog import
    await adapter.switchLocale(lab, "es");
    await lab.clock.waitForIdle();

    lab.page.off("response", onResponse);

    // Ensure at least one dynamic catalog import chunk was tracked
    expect(catalogSizes.length).toBeGreaterThan(0);

    // Check payload budgets (adjusted to 10KB to support Vite dev-mode wrapper overhead)
    for (const size of catalogSizes) {
      expect(size).toBeLessThan(10 * 1024); // 10 KB maximum limit
    }
  },
};

executeContract(performanceSizeContract, allManifests);
