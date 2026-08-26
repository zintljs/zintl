import { expect } from "vite-plus/test";
import { executeContract, type Contract, type AssetsAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * A plainly imported asset resolves to **this locale's** bytes.
 *
 * The `assets` contract measures the other delivery mode: an import carrying
 * `?raw`, which asks for an asset's contents and gets them inlined into the
 * catalog. This one measures the mode that did not exist before proposal 035 —
 * a plain import, which asks for a URL, and which any bundler already answers
 * for an ordinary asset.
 *
 * **Bytes, not URLs.** The tempting assertion is that the `src` differs between
 * locales, and it is the one that would have passed against the old behaviour:
 * a per-locale path pointing at a copy of the source file looks entirely correct
 * in the DOM. So the page fetches what the URL actually serves and compares it
 * to what the manifest says a person authored for that locale. An English image
 * at the Arabic URL fails here and nowhere else.
 *
 * The fetch runs **in the page** rather than through Playwright's request API,
 * so it resolves the URL exactly as the application would — same origin, same
 * base, same dev-server rewrites.
 */
export const assetReferenceContract: Contract<AssetsAdapter> = {
  name: "Asset Reference Delivery",
  description: "Verifies a plainly imported asset resolves to the active locale's authored bytes",
  requires: ["asset-reference"],
  async execute(lab, adapter) {
    const reference = adapter.referenceAsset;
    if (!reference) {
      throw new Error(
        `This project claims "asset-reference" without declaring "referenceAsset". The capability ` +
          `is the claim that the adapter can say which asset is delivered by URL and what bytes ` +
          `each locale owes; claiming it without saying is the one state the capability model ` +
          `cannot express.`,
      );
    }

    const servedBase64 = async (): Promise<string> => {
      const src = await lab.page.locator(reference.selector).first().getAttribute("src");
      expect(src, `${reference.selector} has no src`).toBeTruthy();
      return lab.page.evaluate(async (url: string) => {
        const response = await fetch(url);
        const buffer = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (const byte of buffer) binary += String.fromCharCode(byte);
        return btoa(binary);
      }, src!);
    };

    const seen: Record<string, string> = {};

    for (const [locale, expected] of Object.entries(reference.bytes)) {
      await adapter.navigateLocale(lab, locale);
      await lab.clock.waitForIdle();

      const actual = await servedBase64();
      expect(actual, `${locale} served bytes that are not the ones authored for ${locale}`).toBe(
        expected,
      );
      seen[locale] = actual;
    }

    /**
     * Substitution, not coincidence.
     *
     * Every locale matching its own bytes is already the whole guarantee, but
     * only while the fixture's locales genuinely differ. Asserting that they do
     * keeps a future manifest from weakening the contract by declaring the same
     * bytes twice and passing for free.
     */
    const distinct = new Set(Object.values(seen));
    expect(distinct.size, "every locale served identical bytes — nothing was substituted").toBe(
      Object.keys(seen).length,
    );
  },
};

executeContract(assetReferenceContract, allManifests);
