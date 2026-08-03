import { executeContract, type Contract, type LocaleSwitchAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

function findCatalogPath(root: string): string {
  const vanillaPath = join(root, "src/i18n/translations.json");
  if (existsSync(vanillaPath)) {
    return "src/i18n/translations.json";
  }

  const zintlDir = join(root, "zintl");
  if (existsSync(zintlDir)) {
    const files: string[] = [];
    const getFiles = (dir: string) => {
      const list = readdirSync(dir, { withFileTypes: true });
      for (const entry of list) {
        const res = join(dir, entry.name);
        if (entry.isDirectory()) {
          getFiles(res);
        } else if (res.endsWith(".es.json") || res.endsWith(".ar.json")) {
          files.push(res);
        }
      }
    };
    getFiles(zintlDir);
    if (files.length > 0) {
      return relative(root, files[0]);
    }
  }
  throw new Error(`Could not find any translation catalog JSON file in ${root}`);
}

export const chaosCatalogContract: Contract<LocaleSwitchAdapter> = {
  name: "Chaos Catalog",
  description:
    "Verifies compiler and runtime resilience when translation catalogs are deleted or corrupted",
  requires: ["spa", "hmr", "chaos"],
  strictDeliveryExempt: "deletes and corrupts catalogs; the runtime legitimately cannot apply them",
  async execute(lab, adapter) {
    const catalogPath = findCatalogPath(lab.root);
    const originalCatalog = await lab.fs.read(catalogPath);

    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

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

    // Reload the page to ensure the browser recovers from temporary module load errors and fetches healed catalog state
    await lab.page.reload();
    await lab.clock.waitForIdle();

    await lab.assert.textEventually(adapter.headingSelector, "Chaos Recovered!");
  },
};

executeContract(chaosCatalogContract, allManifests);
