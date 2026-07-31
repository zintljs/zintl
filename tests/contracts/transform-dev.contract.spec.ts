import { executeProjectContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const devTransformContract: Contract = {
  name: "Dev Transform Snapshot",
  description: "Verifies development-mode transform snapshots of all example source files",
  requires: ["transform"],
  async execute(lab, adapter, manifest) {
    const result = await lab.driver.compile("development");
    const allModules = { ...result.modules, ...result.virtualModules };
    const snapshotContent = lab.pipeline.filterForSnapshots(allModules);
    await lab.assert.snapshotAll(`${manifest.name}/dev-transforms`, snapshotContent);
  },
};

executeProjectContract(devTransformContract, allManifests);
