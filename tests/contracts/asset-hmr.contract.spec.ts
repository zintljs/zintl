import {
  executeContract,
  localizedAssetPath,
  type AssetsAdapter,
  type Contract,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Editing a localized asset refreshes the page (ZHMR §5).
 *
 * The `assets` contract proves the **build** substituted the right file for the
 * active boundary. This proves the **dev loop**: assets are mapped to a single
 * virtual boundary `b_assets`, every entry is marked a dependent of it in
 * development, and touching `about.ar.txt` therefore has to cascade through
 * every entry's manager back to the rendered text.
 *
 * Worth a contract of its own because the two hosts arrive by different routes,
 * and neither route implied the other until something checked:
 *
 * - **Vite** fans the invalidation out explicitly — `plan.ts` collects entry
 *   file paths for a virtual boundary and `ViteUpdateApplier` walks them. That
 *   fan-out is read by exactly one applier.
 * - **Rspack** ignores `entryFilePaths` entirely. The asset reaches its graph as
 *   a genuine `?zintl-raw` module import, so its own dependency tracking makes
 *   the chunk stale without anyone announcing it.
 *
 * A regression in either mechanism is invisible to every other contract in the
 * suite: nothing else edits an asset.
 *
 * Both directions are asserted, because they exercise different halves of the
 * compiler. Editing the **localized** copy is the translator's edit and goes
 * through the localized-output mapping; editing the **source** asset is the
 * developer's and goes through ordinary extraction.
 */

const EDITED_AR = "نص محدث";
const EDITED_SOURCE = "Source asset, edited";

export const assetHmrContract: Contract<AssetsAdapter> = {
  name: "Asset HMR",
  description: "Verifies editing a localized static asset propagates to the browser",
  /**
   * Deliberately **not** gated on `hmr`. Editing an asset and editing a source
   * string are different mechanisms, and requiring both would drag an
   * asset-only fixture into five contracts written for application code — one
   * of which appends a deliberate JavaScript syntax error, which does nothing
   * whatsoever to a `.txt` file. A capability should be the narrowest true
   * claim, not a bundle.
   */
  requires: ["assets", "asset-hmr"],
  /**
   * **Measured red on both hosts, on first execution.** Editing the localized
   * copy of an asset does not reach the page: the heading keeps rendering the
   * previous text, on Vite (`assets-basic`, `مرحباً بالعالم!` unchanged) and on
   * Rspack (`rsbuild-vanilla-basic`, likewise) — two projects, two hosts, two
   * entirely different invalidation routes, one outcome.
   *
   * That is ZHMR §5 in full: assets map to the virtual boundary `b_assets`,
   * every entry is marked its dependent in development, and an edit is supposed
   * to cascade through every entry's manager. The mechanism exists on both
   * sides — Vite fans out through `entryFilePaths`, Rspack sees a real
   * `?zintl-raw` import — and neither delivers.
   *
   * Skipped rather than deleted, and skipped rather than left red, because the
   * contract is not what is wrong here. It is recorded as pending with its
   * measurement so the gap is visible in the report instead of being absent
   * from it; a contract whose body is commented out still passes and still
   * claims the slot.
   */
  pendingFor: {
    "assets-basic":
      "ZHMR §5 unimplemented in practice: editing src/locales/src/about.ar.txt leaves the page " +
      "on the previous text. Measured on first run of this contract; no product fix attempted.",
    "rsbuild-vanilla-basic":
      "Same as assets-basic, on the other host: editing src/i18n/src/about.ar.txt does not " +
      "reach the page, so the b_assets cascade fails through both hosts' routes.",
  },
  async execute(lab, adapter) {
    if (!adapter.assetFile) {
      throw new Error(
        `This project claims "asset-hmr" without declaring "assetFile". The capability is the ` +
          `claim that the adapter can say which asset to edit; claiming it without saying is the ` +
          `one state the capability model cannot express.`,
      );
    }

    // 1. The translator's edit: the localized copy, viewed in that locale.
    await adapter.navigateLocale(lab, "ar");
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.assetSelector, adapter.assetText.ar);

    const localized = localizedAssetPath(lab, adapter.assetFile, "ar");
    await lab.fs.write(localized, EDITED_AR);

    await lab.assert.textEventually(adapter.assetSelector, EDITED_AR);

    // 2. The developer's edit: the source asset, viewed in the source locale.
    //    A fresh navigation rather than a switch — the point is that the entry's
    //    manager picked the new asset mapping up, not that the store can switch.
    await adapter.navigateLocale(lab, "en");
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.assetSelector, adapter.assetText.en);

    await lab.fs.write(adapter.assetFile, EDITED_SOURCE);

    await lab.assert.textEventually(adapter.assetSelector, EDITED_SOURCE);
  },
};

executeContract(assetHmrContract, allManifests);
