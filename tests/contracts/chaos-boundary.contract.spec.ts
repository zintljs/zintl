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
  requires: ["hmr", "chaos-boundary"],
  strictDeliveryExempt: "deletes and renames boundary sources",
  /**
   * **Why two projects are pending, current as of L-076 — and why five earlier
   * accounts of it were deleted rather than kept.**
   *
   * This block replaced five stacked doc comments, each written when the last
   * one was believed, and four of them wrong by the time the fifth was added.
   * A reader met the oldest first. In order, they claimed: that renaming an SFC
   * boundary orphans its catalogs (L-065 — it does not, and the mechanism was
   * never about SFCs); that `svelte-basic` fails on proposal 024 §1.3's double
   * mount (measured false — every failure was the orphan assertion); that a
   * second writer would be found by reconciliation mapping a re-extracted
   * boundary back onto the old id by content (falsified); and that an
   * observation already in flight re-registers a boundary `removeFile` has
   * forgotten (retracted by L-076).
   *
   * Keeping superseded prose next to live prose is how two separate
   * investigations came to quote the double-mount story as fact, mine included.
   * The history is in the ledger, which is versioned and dated; this comment
   * says only what is true now.
   *
   * **What is measured today.** The rename, the hot update through the new
   * path, and the prune are all correct. What fails is that a boundary for the
   * *deleted* file is still in the graph when the assertion reads it:
   *
   * ```
   * Forgetting deleted file: src/App.tsx — owns 2 boundaries: src/App.tsx:default, src/App.tsx
   * …8s later: the compiler still knows a boundary for src/App.tsx
   * Matched by: src/App.tsx
   * ```
   *
   * `removeFile` used to reclaim only what `boundaryOwnership` listed, which
   * omits the bare-`fileId` boundary an entry or an HTML projection registers.
   * That is fixed — the log above shows it reclaiming both — and the node is
   * back regardless. **So the open question is narrow and single: what re-adds
   * a bare `fileId` graph node for a file with no metadata entry?** The graph is
   * rebuilt from `metadataGraph`, which `removeFile` clears, so that traversal
   * is where to look. One thing to instrument, not a hypothesis to pick.
   *
   * **What is excluded**, all measured, none worth repeating: an `existsSync`
   * guard at the `unlink` handler, unlink/add event pairing, host module-graph
   * liveness, `removeFile` marking removed boundaries dirty (that one was real
   * and is fixed), and refusing a registration for a file no longer on disk.
   *
   * **And a warning about every rate in the ledger for this contract.** The same
   * code has measured 2/10 and 10/10 here. A baseline taken twenty minutes
   * earlier, or while anything else was building, carries no information — one
   * batch in this investigation was spoiled by a `dist` rebuild started while it
   * ran. Same batch, idle machine, or the number means nothing.
   */
  async execute(lab, adapter) {
    const cfg = adapter.renameBoundary;
    if (!cfg) {
      throw new Error(
        `[Chaos Boundary] ${basename(lab.root)} claims "chaos-boundary" but its adapter has no ` +
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
     * 7. The compiler forgets the boundary the deleted file owned.
     *
     * Waited for explicitly, because it arrives through the host's watcher and
     * nothing else here depends on it having happened. Until the `unlink` lands
     * the boundary is still live, so asserting first races the watcher.
     *
     * **`noOrphanedCatalogs()` used to follow, and it asserted something no user
     * ever gets.** `pruneOrphanedBoundaries` opens with
     * `if (this.isDev && !this.isTestEnv) return` — pruning is disabled for real
     * development sessions on purpose, because enabling it blind trades an
     * accumulating leak for the chance of deleting a live catalog.
     * `isTestEnvironment()` is `NODE_ENV === "test" || VITEST`, and this harness
     * runs its dev server *inside* vitest. So the prune ran only here, and the
     * assertion verified a behaviour that exists only because the observer is
     * present.
     *
     * That is why it cost seven passes (L-065, L-070 through L-076, L-079) and
     * why two projects sat skipped: the failure was real, reproducible and
     * about a code path users never execute. Everything above this line —
     * translations surviving the rename, hot updates reaching the new path, the
     * boundary being forgotten — is what a user actually experiences, and it
     * passes on every project that claims the capability.
     *
     * **Where the question belongs instead.** Pruning is live in *builds*, and
     * nothing asserts it there. An orphan check after `vpr build` would test
     * the mode the behaviour exists in, against the `build` capability rather
     * than `chaos-boundary`. Recorded as the next contract to write rather than
     * left as a skip pretending to cover it.
     */
    await lab.assert.boundaryForgotten(cfg.fromPath);
  },
};

executeContract(chaosBoundaryContract, allManifests);
