import { expect } from "@playwright/test";
import { executeContract, type Contract } from "@zintl/testing";
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
  async execute(lab, adapter) {
    const exampleName = basename(lab.root);
    const cfg = getRenameConfig(exampleName);

    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    // 1. Read original content of the boundary component
    const boundaryContent = await lab.fs.read(cfg.fromPath);

    // 2. Write the new boundary component file (so it exists on disk before parent imports it)
    await lab.fs.write(cfg.toPath, boundaryContent);

    // 3. Update parent import statement to point to the new file
    await lab.fs.edit(cfg.parentPath, (content) => {
      if (!content.includes(cfg.importSearch)) {
        throw new Error(
          `Could not find import statement "${cfg.importSearch}" in ${cfg.parentPath}`,
        );
      }
      return content.replace(cfg.importSearch, cfg.importReplace);
    });

    // 4. Delete the old boundary component file (now safe, parent imports the new one)
    await lab.fs.delete(cfg.fromPath);

    // 5. Wait for the new boundary import to successfully resolve and render in the page
    const heading = lab.page.locator(adapter.headingSelector);
    await expect(heading.first()).toContainText(adapter.initialHeadingText, { timeout: 15000 });

    // 6. Edit the newly renamed boundary component file to trigger a message HMR change
    await lab.fs.edit(cfg.toPath, (content) => {
      if (!content.includes(adapter.initialHeadingText)) {
        throw new Error(
          `Heading text "${adapter.initialHeadingText}" not found in renamed file: ${cfg.toPath}`,
        );
      }
      return content.replace(adapter.initialHeadingText, "Boundary Rename Worked!");
    });

    // 7. Verify browser heading converged to the updated message
    const target = lab.page.locator(adapter.headingSelector, {
      hasText: "Boundary Rename Worked!",
    });
    await expect(target.first()).toBeVisible({ timeout: 15000 });
  },
};

executeContract(chaosBoundaryContract, allManifests);
