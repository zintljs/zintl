import { expect } from "vite-plus/test";
import {
  executeContract,
  localizedAssetPath,
  type AssetsAdapter,
  type Contract,
  type Lab,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Re-authoring a referenced artifact reaches the browser.
 *
 * `asset-hmr` proves this for the inline half, where an artifact's text travels
 * *inside* the catalog and so arrives by the same route as every other
 * translation — if the catalog is fresh, the page is fresh.
 *
 * Reference delivery carries a **URL**, and that reasoning does not survive the
 * change. The bytes never pass through Zintl on their way to the page: the
 * browser fetches them itself, from a URL that does not have to change when the
 * file behind it does. So the catalog can be perfectly up to date, the URL
 * correct, the hot update delivered and applied — and the image in the viewport
 * still the old one, held in the HTTP cache. Nothing else in the suite would
 * notice, because everything else compares strings Zintl produced rather than
 * bytes a browser fetched.
 *
 * Both directions, as `asset-hmr` does. Editing the **artifact** is the
 * translator's edit; editing the **source** is the developer's, and it is the
 * only thing that reaches the source locale, whose URL is resolved by a direct
 * import rather than through the catalog.
 *
 * Deliberately **not** asserting that no reload happened. A vanilla entry
 * declines hot updates and lets them bubble (L-035), so a reload is correct
 * behaviour here and forbidding it would fail a project for being right. The
 * guarantee is that the browser ends up with the new bytes, by whichever route.
 */
/**
 * What the asset's URL serves **through the browser's ordinary cache**.
 *
 * The cache mode is the whole measurement. `cache: "no-store"` was here first
 * and made the contract pass without proving anything: it bypasses the HTTP
 * cache, so it reports what the *server* would send rather than what a page
 * would receive — and a stale-cache failure is invisible to it by construction.
 *
 * Default semantics instead, which is what an `<img>`, a `<link>` or any other
 * consumer of this URL gets.
 */
async function servedBase64(lab: Lab, selector: string): Promise<string> {
  const src = await lab.page.locator(selector).first().getAttribute("src");
  expect(src, `${selector} has no src`).toBeTruthy();
  return lab.page.evaluate(async (url: string) => {
    const response = await fetch(url);
    const buffer = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of buffer) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, src!);
}

export const assetRefreshContract: Contract<AssetsAdapter> = {
  name: "Asset Reference Refresh",
  description: "Verifies re-authoring a referenced artifact reaches the browser",
  requires: ["asset-refresh"],
  async execute(lab, adapter) {
    const reference = adapter.referenceAsset;
    if (!reference?.editedBytes) {
      throw new Error(
        `This project claims "asset-refresh" without declaring ` +
          `"referenceAsset.editedBytes". The capability is the claim that the adapter can say what ` +
          `an edit writes; claiming it without saying is the one state the capability model cannot ` +
          `express.`,
      );
    }
    const edited = reference.editedBytes;

    // 1. The translator's edit: this locale's artifact, viewed in this locale.
    await adapter.navigateLocale(lab, "ar");
    await lab.clock.waitForIdle();
    expect(await servedBase64(lab, reference.selector)).toBe(reference.bytes.ar);

    const artifact = localizedAssetPath(lab, reference.file, "ar");
    await lab.fs.writeBytes(artifact, Buffer.from(edited.ar, "base64"));

    await expect
      .poll(() => servedBase64(lab, reference.selector), {
        message: `re-authoring ${artifact} did not reach the browser`,
      })
      .toBe(edited.ar);

    // 2. The developer's edit: the source asset, viewed in the source locale.
    //    Its URL comes from a direct import rather than from the catalog, so it
    //    is a different path to the same page and neither implies the other.
    await adapter.navigateLocale(lab, "en");
    await lab.clock.waitForIdle();
    expect(await servedBase64(lab, reference.selector)).toBe(reference.bytes.en);

    await lab.fs.writeBytes(reference.file, Buffer.from(edited.en, "base64"));

    await expect
      .poll(() => servedBase64(lab, reference.selector), {
        message: `re-authoring ${reference.file} did not reach the browser`,
      })
      .toBe(edited.en);
  },
};

executeContract(assetRefreshContract, allManifests);
