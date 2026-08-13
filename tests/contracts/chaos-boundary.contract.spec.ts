import { executeContract, type ChaosAdapter, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { basename } from "node:path";

/**
 * TODO: reproduce the React half of proposal 024 §1.3.
 *
 * This contract reproduced the Svelte double-mount — rename the file the entry
 * imports, the entry's own source changes, it self-accepts, re-executes, and
 * mounts again — and `RuntimeFacet.entryReexecutionSafe` fixed it. React has the
 * same shape and a louder symptom: `createRoot()` throws on a container it
 * already owns, which is the unmountable 103-byte page §1.3 recorded.
 *
 * It does **not** reproduce here. `react-basic` passes this contract with the
 * self-accept in place, so whatever conditions §1.3 hit are not the ones this
 * rename creates — most likely because React Fast Refresh stops propagation at
 * `App.tsx` and `main.tsx` never re-executes.
 *
 * Why this needs a reproduction before a fix, rather than after: marking React
 * unsafe was tried and reverted once, because detection used to guess `"react"`
 * for any project where it found nothing — so `vanilla-spa-basic` inherited the
 * claim and began full-reloading on every entry edit.
 *
 * **That blast radius is gone.** Ledger L-034 removed the guess: a project with
 * no framework now resolves no framework facets, so a constraint on the React
 * facet reaches React projects only. The fix is still one field
 * (`reactRuntimeFacet` with `entryReexecutionSafe: false`) and what is still
 * missing is a failing test that justifies it — but the reason to hesitate is
 * now the evidence, not the collateral damage.
 *
 * A reproduction probably needs an entry whose *own* source changes in a way
 * Fast Refresh will not absorb — editing a non-component export in `main.tsx`,
 * or a project without the React plugin's refresh boundary.
 */
export const chaosBoundaryContract: Contract<ChaosAdapter> = {
  name: "Chaos Boundary",
  description:
    "Verifies compiler updates and HMR propagation continue to function after boundary files are renamed",
  requires: ["spa", "hmr", "chaos"],
  strictDeliveryExempt: "deletes and renames boundary sources",
  /**
   * Live on three of four projects.
   *
   * **The deletion blocker is fixed.** The plugin now listens for `unlink` and
   * tells the compiler to forget the file, so a deleted boundary no longer
   * survives in the graph for the life of a pooled dev server — which used to
   * leak into every contract that ran afterwards, and, through the shared
   * manifest, into the committed examples themselves.
   *
   * What remains is `svelte-basic`, and it is proposal 024 §1.3: renaming the
   * file the entry imports rewrites the entry's own source, the entry
   * self-accepts, re-executes, and mounts a second time onto a container that
   * already has a mount. The page renders twice and the heading selector reads
   * the stale copy.
   *
   * See the note in `viteFacet.hmrInjectionCode`. The obvious fix —
   * `import.meta.hot.invalidate()` — makes this pass and was measured: it turns
   * every entry-adjacent edit into a full page reload, regressing `hmr-hammer`
   * on every project and taking the suite from ~75 s to ~127 s. The real fix is
   * a matching `dispose()` that tears the previous mount down, which is
   * framework knowledge and belongs in a framework facet.
   */
  async execute(lab, adapter) {
    const cfg = adapter.renameBoundary;
    if (!cfg) {
      throw new Error(
        `[Chaos Boundary] ${basename(lab.root)} claims "chaos" but its adapter has no ` +
          `renameBoundary. Which file to rename is a per-project fact and belongs in the manifest.`,
      );
    }

    await adapter.navigateHome(lab);
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    // 1. Read original content of the boundary component
    const boundaryContent = await lab.fs.read(cfg.fromPath);

    // 2. Write the new file first, so it exists before the parent imports it
    await lab.fs.write(cfg.toPath, boundaryContent);

    // 3. Point the parent's import at the new file
    await lab.fs.edit(cfg.parentPath, (content) => {
      if (!content.includes(cfg.importSearch)) {
        throw new Error(`Could not find import "${cfg.importSearch}" in ${cfg.parentPath}`);
      }
      return content.replace(cfg.importSearch, cfg.importReplace);
    });

    // 4. Delete the old file — now safe, the parent imports the new one
    await lab.fs.delete(cfg.fromPath);

    // 5. The app still renders: a rename must not lose the translations
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    // 6. The renamed boundary still propagates hot updates
    await lab.fs.edit(cfg.toPath, (content) => {
      if (!content.includes(adapter.initialHeadingText)) {
        throw new Error(`Heading "${adapter.initialHeadingText}" not found in ${cfg.toPath}`);
      }
      return content.replace(adapter.initialHeadingText, "Boundary Rename Worked!");
    });

    await lab.assert.textEventually(adapter.headingSelector, "Boundary Rename Worked!");

    // 7. The deleted boundary's catalogs are reclaimed, not left orphaned
    await lab.assert.noOrphanedCatalogs();
  },
};

executeContract(chaosBoundaryContract, allManifests);
