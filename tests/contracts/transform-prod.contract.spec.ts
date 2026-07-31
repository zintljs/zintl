import { executeProjectContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const prodTransformContract: Contract = {
  name: "Prod Transform Snapshot",
  description: "Verifies production-mode transform snapshots of all example source files",
  requires: ["transform"],
  async execute(lab, adapter, manifest) {
    const result = await lab.driver.compile("production");
    const allModules = { ...result.modules, ...result.virtualModules };
    const snapshotContent = lab.pipeline.filterForSnapshots(allModules);
    await lab.assert.snapshotAll(`${manifest.name}/prod-transforms`, snapshotContent);
  },
};

executeProjectContract(prodTransformContract, allManifests);
