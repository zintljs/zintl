import { executeProjectContract, type Contract } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const buildContract: Contract<any> = {
  name: "Production Build",
  description: "Verifies final production build output (dist client and server)",
  requires: ["build"],
  async execute(lab, adapter, manifest) {
    const targets = manifest.buildTargets ?? [{ name: "dist" }];

    for (const target of targets) {
      const results = await lab.pipeline.build(target.overrides);
      const snapshot = lab.pipeline.filterDistForSnapshots(results);
      await lab.assert.snapshotAll(`${manifest.name}/${target.name}-output`, snapshot);
    }
  },
};

executeProjectContract(buildContract, allManifests);
