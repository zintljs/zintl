import { expect } from "@playwright/test";
import { executeContract, type Contract, type LocaleSwitchAdapter } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const localeSwitchContract: Contract<LocaleSwitchAdapter> = {
  name: "Locale Switch",
  description:
    "Verifies that switching locale updates DOM attributes and triggers dynamic catalog fetching",
  requires: ["spa", "locale-switch", "rtl"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    // 1. Verify initial state
    await lab.assert.locale("en");

    // 2. Start capturing network requests
    const networkCapture = lab.network.capture();

    // 3. Switch locale to Arabic
    await adapter.switchLocale(lab, "ar");
    await lab.clock.waitForIdle();

    const requests = networkCapture.stop();

    // 4. Verify DOM elements reflect Arabic locale
    await lab.assert.locale("ar");
    await lab.assert.dir("rtl");

    // 5. Verify that the Arabic translation catalog request was captured
    const arCatalogRequest = requests.find((req) => req.url.includes("virtual:zintl/content/ar/"));
    expect(arCatalogRequest).toBeDefined();
  },
};

executeContract(localeSwitchContract, allManifests);
