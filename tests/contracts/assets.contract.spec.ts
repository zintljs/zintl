import { expect } from "vite-plus/test";
import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { assetsBasicText } from "../fixtures/assets-basic.js";

/**
 * Localized static assets reach the browser.
 *
 * The source locale must render the original asset, and a target locale must
 * render the localized copy — proving the compiler substituted the asset for
 * the active boundary rather than inlining the source text once.
 */
export const assetsContract: Contract = {
  name: "Localized Assets",
  description: "Verifies a localized static asset is served for the active locale",
  requires: ["assets"],
  async execute(lab, adapter) {
    // 1. Source locale renders the original asset.
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const heading = lab.page.locator(adapter.headingSelector);
    await heading.waitFor({ state: "visible", timeout: 15000 });
    expect(await heading.textContent()).toContain(assetsBasicText.source);

    // 2. Target locale renders the localized copy.
    await lab.page.goto(`${lab.url}/?lang=ar`);
    await lab.clock.waitForIdle();

    const arHeading = lab.page.locator(adapter.headingSelector);
    await arHeading.waitFor({ state: "visible", timeout: 15000 });
    const arText = await arHeading.textContent();
    expect(arText).toContain(assetsBasicText.arabic);
    // Substitution, not addition: the source asset must be gone, otherwise a
    // build that simply inlined the original would satisfy the check above.
    expect(arText).not.toContain(assetsBasicText.source);
  },
};

executeContract(assetsContract, allManifests);
