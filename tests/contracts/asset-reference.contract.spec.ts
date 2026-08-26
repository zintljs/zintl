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
  /**
   * **Red, for a Zintl reason, and written before the fix rather than after.**
   *
   * Measured on `assets-authored`: both locales resolve `#asset-image` to
   * `/src/hero.png` — the source file — so `en` passes and `ar` serves red
   * bytes where blue were authored. Not a fixture problem and not a host one.
   *
   * Reference delivery is only half built. A plain import is a **static
   * binding**: the module resolves once, to one URL, and nothing re-reads it
   * when the locale changes. It therefore varies by locale exactly where module
   * *identity* varies by locale — a multiplexed build, where resolution rewrites
   * the import per locale and which
   * `asset_scenarios.test.ts` covers end to end. It does not vary where the
   * locale is a runtime variable, which is every dev server and every
   * runtime-switchable app.
   *
   * The inline half solves this with a proxy that calls `_t(assetKey)` on every
   * read. Reference needs the same treatment with a URL for a value, and that
   * needs per-locale artifact URLs in the catalog *in dev* — where they are
   * absent, because `getAssetTranslations` contributes nothing for a reference
   * asset and a dev-servable URL is a per-host fact. Proposal 035 §5.3 called
   * this "a locale → URL map reaching the runtime" and named it the one
   * genuinely new mechanism; §12.2 then claimed the catalog already carried it,
   * which is true of a build and false of a dev server.
   *
   * Kept executable rather than deleted, because the assertion is right and the
   * behaviour is not. Delete this field to collect the fix.
   */
  pending:
    "Reference delivery is static per module, so it varies by locale only in a " +
    "multiplexed build. A runtime-variable locale needs per-locale artifact URLs " +
    "in the dev catalog — 035 §5.3's locale → URL map, not yet built.",
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
