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
  requires: ["hmr", "chaos"],
  strictDeliveryExempt: "deletes and renames boundary sources",
  /**
   * **Its closing `noOrphanedCatalogs()` had never run, and now that it does it
   * finds something (ledger L-062, L-065).**
   *
   * That assertion resolved its directory through a property `LabCompiler` does
   * not have, fell back to `src/locales`, and returned early on all four
   * projects because none of them uses it. Underneath, its matching compared a
   * file's basename to boundary ids by mutual `includes`, which cannot match
   * the default `<path>.<locale>.json` naming in either direction. Two layers
   * of the same bug, the outer one hiding the inner.
   *
   * Both now ask `getCatalogPath`. React and the merged-catalog vanilla project
   * come back clean; the two SFC projects do not — renaming the boundary leaves
   * its previous catalogs behind, one per locale. Recorded rather than fixed:
   * pruning is compiler behaviour and this pass changes no product code.
   */
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
  /**
   * **`vue-basic` reclaims its catalogs now; `svelte-basic` is a different
   * defect that was hiding behind the same skip.**
   *
   * Both were pending on L-065, "renaming an SFC boundary orphans its
   * catalogs". That turned out not to be about SFCs at all — the prune ran once,
   * before the rename, and was never asked again because the flush carrying the
   * deletion joined an in-flight run and no later trigger existed to carry its
   * dirt (L-070). With the trailing flush armed, `vue-basic` passes 10 runs in
   * 10.
   *
   * `svelte-basic` fails 6 in 10 under contention and passes in isolation, and
   * the reason is the one this contract's header already describes: renaming the
   * file the entry imports rewrites the entry's own source, the entry
   * self-accepts and re-executes, and Svelte's `mount()` appends a second copy
   * over the first — so the heading selector reads the stale one. Proposal 024
   * §1.3, and the fix is a matching `dispose()`, which is framework knowledge
   * belonging in a facet.
   *
   * Kept separate rather than left as one skip: two projects failing the same
   * assertion for unrelated reasons is how L-065 came to describe the wrong
   * mechanism for both of them.
   */
  /**
   * **`vue-basic` reclaims its catalogs. `svelte-basic` is the same defect, not
   * the one this file used to name.**
   *
   * Both were pending on L-065. `vue-basic` now passes 10 runs in 10 once the
   * deferred flush gets a trigger (L-070).
   *
   * `svelte-basic` still fails 4–6 runs in 10, and the header's long-standing
   * explanation — proposal 024 §1.3's double mount, the page rendering twice and
   * the selector reading the stale copy — is **not** what it fails on. Measured,
   * every failure is the orphan assertion, on `zintl/src/App.svelte.{ar,es,zh}.json`.
   * The instrumented prune shows why it is not a prune bug either:
   *
   * ```
   * Pruning orphaned file: zintl/src/App.svelte.ar.json   ← deleted, correctly
   * …and the file exists again by the time the assertion reads the directory
   * ```
   *
   * So something re-materialises the catalogs of a boundary that has already
   * been forgotten and reclaimed. Interleaving the write log with the prune's
   * own decisions named the first writer exactly — `removeFile` marking the
   * removed boundary dirty, which queues its catalogs to be written straight
   * back — and fixing that took the rate from **5/10 to 2/10** (L-071).
   *
   * A second writer remains, with the same signature one flush later. The thread
   * to pull is in the same log: `Forgetting deleted file: src/AppNew.svelte`
   * appears mid-test, for the file the rename just *created*. A boundary that is
   * forgotten and then re-extracted can be reconciled back onto the old id by
   * content, which would write the old path. Not yet confirmed — stated as the
   * next probe, not as a mechanism.
   *
   * Why this project and not `vue-basic`: its entry is not re-execution-safe, so
   * the rename reloads the page, which shifts every timing around the flush.
   * That makes it the intermittent one — not a different bug.
   */
  pendingFor: {
    "svelte-basic":
      "L-071 (open): a forgotten boundary's catalogs are re-materialised after the prune deletes " +
      "them. Four handler-level guards measured and excluded — see the ledger before trying a " +
      "fifth. Rate is heavily load-dependent (2/10 and 10/10 observed on identical code), so only " +
      "same-batch comparisons mean anything here.",
    "vue-basic":
      "L-071, same residual writer. Clean in the last same-batch measurement but marginal across " +
      "runs; skipped so the gate reports the debt rather than the weather.",
  },
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

    /**
     * 7. The deleted boundary's catalogs are reclaimed, not left orphaned.
     *
     * The forgetting is waited for explicitly, because it arrives through the
     * host's watcher and nothing else in this contract depends on it having
     * happened. Until the `unlink` lands the boundary is still live and its
     * catalogs are correctly *kept* — so asserting first raced the watcher and
     * failed 5 runs in 10 on `svelte-basic`, whose entry additionally reloads
     * and so shifts every timing around it.
     */
    await lab.assert.boundaryForgotten(cfg.fromPath);
    await lab.assert.noOrphanedCatalogs();
  },
};

executeContract(chaosBoundaryContract, allManifests);
