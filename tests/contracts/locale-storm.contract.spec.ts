import { expect } from "vite-plus/test";
import { executeContract, type Contract, type LocaleSwitchAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const localeStormContract: Contract<LocaleSwitchAdapter> = {
  name: "Locale Switch Storm",
  description:
    "Verifies rapid locale transitions under throttled network conditions converge correctly",
  requires: ["spa", "locale-switch", "locale-switch-stress", "rtl"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    // 1. Establish CDP session for network emulation
    const context = lab.page.context();
    let client: any;
    try {
      client = await context.newCDPSession(lab.page);
      await client.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 400, // 400ms latency to delay dynamic module chunks
        downloadThroughput: 50 * 1024, // 50 KB/s
        uploadThroughput: 50 * 1024,
      });
    } catch (e) {
      console.warn(
        "[Locale Storm Spec] CDP network emulation not supported on this browser context:",
        e,
      );
    }

    // 2. Click switchers in rapid succession (ar -> es -> zh -> ar)
    try {
      await adapter.switchLocale(lab, "ar");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await adapter.switchLocale(lab, "es");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await adapter.switchLocale(lab, "zh");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await adapter.switchLocale(lab, "ar"); // Converge back to Arabic
    } finally {
      // 3. Remove network throttling immediately
      if (client) {
        await client.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
      }
    }

    // 4. Wait for browser to process the queue and settle
    await lab.clock.waitForIdle();

    // 5. Assert the page successfully converges on Arabic and RTL layout direction
    await lab.assert.locale("ar");
    await lab.assert.dir("rtl");

    // 6. Assert no undefined translations or hydration mismatch errors occurred
    const consoleErrors = lab.console.errors;
    const translationErrors = consoleErrors.filter(
      (e) =>
        e.text.toLowerCase().includes("hydration") ||
        e.text.toLowerCase().includes("mismatch") ||
        e.text.toLowerCase().includes("undefined"),
    );
    expect(translationErrors).toHaveLength(0);
  },
};

executeContract(localeStormContract, allManifests);
