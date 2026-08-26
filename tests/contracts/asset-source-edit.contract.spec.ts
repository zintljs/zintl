import { expect } from "vite-plus/test";
import {
  executeContract,
  localizedAssetPath,
  type AssetsAdapter,
  type Contract,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

const EDITED_SOURCE = "Source asset, rewritten from top to bottom.";

/**
 * Editing a source asset changes the source locale and **nothing else**.
 *
 * Proposal 035 §3: content never crosses between a source asset and a localized
 * one. The compiler must not copy, and must not compare — a source edit does not
 * imply a localized change, and a compiler that can only see that bytes differ
 * cannot tell which kind of change it was.
 *
 * This is the end-to-end statement of the rule the old model broke hardest.
 * Editing `about.txt` used to score how far the body had drifted, rewrite every
 * localized sibling with a `[ZINTL WARNING]` banner, and — past a threshold —
 * replace the translated body with the English one outright. A translator's work
 * was destroyed by somebody else fixing a typo.
 *
 * `asset-hmr` proves each edit *reaches* the browser. It cannot prove this,
 * because it looks at one locale at a time and the damage is always in the other
 * one. Both files are checked here: the artifact on disk, byte for byte, and
 * what the target locale actually renders afterwards.
 */
export const assetSourceEditContract: Contract<AssetsAdapter> = {
  name: "Asset Source Edit Isolation",
  description: "Verifies editing a source asset leaves every localized artifact untouched",
  requires: ["asset-hmr"],
  async execute(lab, adapter) {
    if (!adapter.assetFile) {
      throw new Error(
        `This project claims "asset-hmr" without declaring "assetFile". The capability is the ` +
          `claim that the adapter can say which asset to edit; claiming it without saying is the ` +
          `one state the capability model cannot express.`,
      );
    }

    const artifact = localizedAssetPath(lab, adapter.assetFile, "ar");
    const before = await lab.fs.read(artifact);

    // The developer's edit, in the source locale where it belongs.
    await adapter.navigateLocale(lab, "en");
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.assetSelector, adapter.assetText.en);

    await lab.fs.write(adapter.assetFile, EDITED_SOURCE);
    await lab.assert.textEventually(adapter.assetSelector, EDITED_SOURCE);

    /**
     * Byte for byte, and read from disk rather than from the page.
     *
     * The rendered text can be right while the file is wrong — a warning banner
     * prepended to a translation still renders the translation. On-disk equality
     * is the only assertion that catches the compiler touching a file it has no
     * business touching.
     */
    expect(await lab.fs.read(artifact), `editing ${adapter.assetFile} modified ${artifact}`).toBe(
      before,
    );

    // And the other locale still renders its own words, not the new English.
    await adapter.navigateLocale(lab, "ar");
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.assetSelector, adapter.assetText.ar);

    const arabic = await lab.page.locator(adapter.assetSelector).first().textContent();
    expect(arabic, "the source edit leaked into the Arabic page").not.toContain(EDITED_SOURCE);
  },
};

executeContract(assetSourceEditContract, allManifests);
