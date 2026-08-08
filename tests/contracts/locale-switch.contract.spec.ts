import { expect } from "vite-plus/test";
import { executeContract, type Contract, type LocaleSwitchAdapter } from "@zintljs/testing";
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
    await lab.assert.localeCoherent("en");

    // 2. Start capturing network requests
    const networkCapture = lab.network.capture();

    // 3. Switch locale to Arabic
    await adapter.switchLocale(lab, "ar");
    await lab.clock.waitForIdle();

    const requests = networkCapture.stop();

    // 4. Verify DOM elements reflect Arabic locale — and that the store agrees.
    // Checking the attribute alone passes a page that renders Arabic while
    // announcing English, which is a real defect this suite has seen.
    await lab.assert.localeCoherent("ar");
    await lab.assert.dir("rtl");

    // 5. Verify that the Arabic translation catalog was fetched, not inlined.
    // How a catalog request looks is the host's business — Vite's virtual module
    // names the locale in its URL, an Rspack chunk does not — so the project
    // says, and the default is the Vite spelling.
    const isCatalogRequest =
      adapter.isCatalogRequest ??
      ((url: string, locale: string) => url.includes(`virtual:zintl/content/${locale}/`));
    const arCatalogRequest = requests.find((req) => isCatalogRequest(req.url, "ar"));
    expect(arCatalogRequest).toBeDefined();
  },
};

executeContract(localeSwitchContract, allManifests);
