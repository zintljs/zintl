import {
  executeContract,
  findCatalogFor,
  type Contract,
  type LocaleSwitchAdapter,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * This carried its own `findCatalogPath`, which tried `src/i18n/translations.json`,
 * then walked `zintl/`, and threw `Could not find any translation catalog JSON
 * file` otherwise. Both are real layouts; neither is *the* layout. `outputDir`
 * is a user option, and every Rsbuild example in this repository points it at
 * `src/locales` — a directory that helper had never heard of.
 *
 * The cost was a capability on eight projects. `chaos` went unclaimed across
 * the whole Rspack half of the manifest for a reason that had nothing to do
 * with the host: the contract threw on line one because it could not find files
 * that were sitting right there. That is the third time a **contract**
 * limitation was recorded in a manifest as a **host** limitation (L-049,
 * L-056), and `findCatalogFor` exists so there is not a fourth — it asks the
 * compiler, which resolved `outputDir` and `catalogFormat` and owns
 * `getCatalogPath`.
 *
 * The lookup now happens **after** navigation rather than before it, because
 * asking the compiler requires a compiler to be running.
 */
export const chaosCatalogContract: Contract<LocaleSwitchAdapter> = {
  name: "Chaos Catalog",
  description:
    "Verifies compiler and runtime resilience when translation catalogs are deleted or corrupted",
  requires: ["hmr", "chaos"],
  strictDeliveryExempt: "deletes and corrupts catalogs; the runtime legitimately cannot apply them",
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    const probe = findCatalogFor(lab, { locale: "es", key: adapter.initialHeadingText });
    if (!probe.ok) {
      throw new Error(`Could not find a catalog to break: ${probe.why}`);
    }
    const catalogPath = probe.path;
    const originalCatalog = await lab.fs.read(catalogPath);

    // 1. Verify Spanish locale switches cleanly before chaos
    await adapter.switchLocale(lab, "es");
    await lab.clock.waitForIdle();
    await adapter.switchLocale(lab, "en");
    await lab.clock.waitForIdle();

    // ──────────────────────────────────────────────────────────────────
    // Chaos 1: Deletion of translation catalog
    // ──────────────────────────────────────────────────────────────────
    await lab.fs.delete(catalogPath);

    // Trigger edit to force compiler run
    await lab.fs.edit(adapter.headingFile, (content) => {
      return content.replace(adapter.initialHeadingText, "Chaos Deletion");
    });

    // Page must receive HMR update
    await lab.assert.textEventually(adapter.headingSelector, "Chaos Deletion");

    // Switch locales - must not crash the page, fallbacks must load gracefully
    await adapter.switchLocale(lab, "es");
    await lab.clock.waitForIdle();
    await adapter.switchLocale(lab, "en");
    await lab.clock.waitForIdle();

    // ──────────────────────────────────────────────────────────────────
    // Chaos 2: Corruption of translation catalog
    // ──────────────────────────────────────────────────────────────────
    // Write corrupted JSON structure
    await lab.fs.write(catalogPath, `{"Count is {count}": "El conteo es {count}", `);

    // Trigger edit to force compiler run (compiler will warn, but must not crash the server)
    await lab.fs.edit(adapter.headingFile, (content) => {
      return content.replace("Chaos Deletion", "Chaos Corruption");
    });

    // Wait a brief moment for the compiler loop to process the edit
    await lab.clock.tick(500);

    // Restore pristine catalog content to heal the path
    await lab.fs.write(catalogPath, originalCatalog);

    // Perform final edit to trigger convergence
    await lab.fs.edit(adapter.headingFile, (content) => {
      return content.replace("Chaos Corruption", "Chaos Recovered!");
    });

    /**
     * Reload so the browser recovers from the module-load errors the corrupt
     * catalog caused — **unless the server is already reloading it.**
     *
     * On a host that answers this edit with a `full-reload` of its own, calling
     * `reload()` fires into a frame that is mid-navigation and fails with
     * `net::ERR_ABORTED; maybe frame was detached?` — the contract racing a
     * navigation it did not cause, and reporting it as a defect in the thing
     * under test. Ledger L-061 found and fixed exactly this in `hmr-growth`;
     * the same line was here, unfixed, and stayed green until Rspack projects
     * were allowed to claim `chaos` (L-075) and brought a host that reloads.
     *
     * Retrying rather than skipping, because the reason for reloading is real
     * and a swallowed navigation would leave the page on the corrupt modules:
     * an aborted reload means a navigation is already happening, so waiting for
     * the page to settle is the same destination by the other route.
     */
    await lab.page.reload().catch((err: unknown) => {
      const message = String(err);
      if (!message.includes("ERR_ABORTED") && !message.includes("frame was detached")) {
        throw err;
      }
    });
    await lab.clock.waitForIdle();

    await lab.assert.textEventually(adapter.headingSelector, "Chaos Recovered!");
  },
};

executeContract(chaosCatalogContract, allManifests);
