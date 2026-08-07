import { expect } from "vite-plus/test";
import { executeContract, type Contract, type AssetsAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Localized static assets reach the browser.
 *
 * The source locale must render the original asset, and a target locale must
 * render the localized copy — proving the compiler substituted the asset for
 * the active boundary rather than inlining the source text once.
 *
 * The expected strings and the element holding them come from the adapter, not
 * from a fixture this file imports. That is not tidiness: while they were
 * hardwired to `assets-basic` and asserted against `headingSelector`, the
 * contract described one project rather than a capability, and no second app
 * could claim `assets` without failing on another app's text.
 */
export const assetsContract: Contract<AssetsAdapter> = {
  name: "Localized Assets",
  description: "Verifies a localized static asset is served for the active locale",
  requires: ["assets"],
  async execute(lab, adapter) {
    const source = adapter.assetText.en;
    const arabic = adapter.assetText.ar;

    // 1. Source locale renders the original asset.
    await adapter.navigateLocale(lab, "en");
    await lab.clock.waitForIdle();

    await lab.assert.textEventually(adapter.assetSelector, source);

    // 2. Target locale renders the localized copy.
    await adapter.navigateLocale(lab, "ar");
    await lab.clock.waitForIdle();

    await lab.assert.textEventually(adapter.assetSelector, arabic);
    // Substitution, not addition: the source asset must be gone, otherwise a
    // build that simply inlined the original would satisfy the check above.
    const arText = await lab.page.locator(adapter.assetSelector).first().textContent();
    expect(arText).not.toContain(source);
  },
};

executeContract(assetsContract, allManifests);
