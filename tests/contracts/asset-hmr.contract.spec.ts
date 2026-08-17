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
   * **Green on Vite. Three defects deep, and each one hid the next (L-067).**
   *
   * This contract was red on both hosts when written, with the same symptom —
   * the page keeps rendering the previous text — produced by three independent
   * causes stacked on top of each other. Fixing any one alone changed nothing
   * visible, which is why the section had survived being specified,
   * implemented, and believed:
   *
   * 1. **The compiler never re-read the file.** Asset text lives in the hive,
   *    which only `syncGraphs()` refills, and the asset branch of
   *    `invalidateFile` announced `b_assets` and scheduled a flush without
   *    marking the graph dirty. The entire cascade then ran correctly against
   *    the previous contents.
   * 2. **The text lived in a second module neither host would rebuild.** The
   *    generated catalog imported the asset through a *virtual*,
   *    extension-free id, so Vite's graph could not associate it with the
   *    changed file and Rspack had no declared dependency to go stale on. It is
   *    now inlined in dev, which deletes the second module instead of trying to
   *    synchronise it on two hosts that share no mechanism.
   * 3. **The correct catalog was delivered and then rejected.** The asset
   *    branch returned before the shared `catalogGeneration++`, so the rebuilt
   *    catalog carried the same generation as the one already applied and the
   *    receiver discarded it by Axiom D1 — visible as
   *    `runtime/catalog ar/b_assets #0 → superseded (overtaken by seq 0)`, with
   *    the right text inside it.
   *
   * **Green on both hosts, 0 failures in 10 runs.** `rsbuild-vanilla-basic` was
   * pending here for a fourth reason that turned out not to be about assets at
   * all: the text arrived correctly and a later rebuild put the old one back.
   * That was L-064 — an update nothing in the page could act on — and fixing it
   * cleared this without a line of asset code changing. Re-measured rather than
   * assumed, and the claim restored.
   */
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
