import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { basename } from "node:path";

interface RenameConfig {
  fromPath: string;
  toPath: string;
  parentPath: string;
  importSearch: string;
  importReplace: string;
}

function getRenameConfig(exampleName: string): RenameConfig {
  switch (exampleName) {
    case "vue-basic":
      return {
        fromPath: "src/components/HelloWorld.vue",
        toPath: "src/components/Hello.vue",
        parentPath: "src/App.vue",
        importSearch: "./components/HelloWorld.vue",
        importReplace: "./components/Hello.vue",
      };
    case "react-basic":
      return {
        fromPath: "src/App.tsx",
        toPath: "src/AppNew.tsx",
        parentPath: "src/main.tsx",
        importSearch: "./App",
        importReplace: "./AppNew",
      };
    case "svelte-basic":
      return {
        fromPath: "src/App.svelte",
        toPath: "src/AppNew.svelte",
        parentPath: "src/main.ts",
        importSearch: "./App.svelte",
        importReplace: "./AppNew.svelte",
      };
    case "vanilla-spa-basic":
      return {
        fromPath: "src/main.ts",
        toPath: "src/mainNew.ts",
        parentPath: "index.html",
        importSearch: "/src/main.ts",
        importReplace: "/src/mainNew.ts",
      };
    default:
      throw new Error(`Unsupported example for boundary rename: ${exampleName}`);
  }
}

export const chaosBoundaryContract: Contract = {
  name: "Chaos Boundary",
  description:
    "Verifies compiler updates and HMR propagation continue to function after boundary files are renamed",
  requires: ["spa", "hmr", "chaos"],
  strictDeliveryExempt: "deletes and renames boundary sources",
  /**
   * Restored and runnable — but held back on two blockers, both now identified.
   * It passes on `react-basic`, `vue-basic` and `vanilla-spa-basic`; remove this
   * line to run it.
   *
   * **1. The compiler never learns a file was deleted.** The bundler routes
   * unlinks through a path that does not call `handleHotUpdate`/`hotUpdate`, and
   * there is no watcher listener anywhere in the plugin, so a deleted boundary
   * stays in the graph forever. That is not merely stale state: dev servers are
   * pooled per worker, so the orphan leaks into every contract that runs after
   * this one — enabling this contract silently added `src/AppNew.tsx` to four
   * committed `boundary-graph` snapshots. **This is the blocker to fix first**,
   * and it is upstream of the pruning the original TODO here described. Pruning
   * itself now works: the no-orphan assertion below passes on three of four.
   *
   * **1a. FIXED — the leak no longer escapes into the committed examples.**
   * The symlink farm shared the compiler's persisted manifest between the copy
   * and the real example, so this contract wrote a phantom boundary into four
   * examples' manifests and the next `build:examples` generated catalogs for
   * source that did not exist, into the tracked tree. `.zintl` is now copied
   * per worker instead of linked, verified by running this contract live and
   * confirming the examples stay clean.
   *
   * **2. Entry double-mount on `svelte-basic`** — proposal 024 §1.3. Renaming
   * the file the entry imports rewrites the entry's own source, the entry
   * self-accepts, re-executes, and mounts a second time onto a container that
   * already has a mount. The page renders twice and the heading selector reads
   * the stale copy. See the note in `viteFacet.hmrInjectionCode`: the obvious
   * fix (`invalidate()`) was measured and regresses the suite from ~75 s to
   * ~127 s, so the real fix is a framework-side `dispose()`.
   */
  pending:
    "deleted boundaries are never removed from the compiler graph and leak across pooled dev servers; " +
    "plus entry double-mount on svelte (024 §1.3) — see the comment above",
  async execute(lab, adapter) {
    const exampleName = basename(lab.root);
    const cfg = getRenameConfig(exampleName);

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
