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
  pendingFor: {
    "svelte-basic":
      "entry double-mount on rename (proposal 024 §1.3) — needs a framework-side hot.dispose()",
  },
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
