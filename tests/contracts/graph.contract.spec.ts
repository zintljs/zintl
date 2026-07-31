import { executeProjectContract, serializeDeterministic, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

export const graphContract: Contract = {
  name: "Serialized Graphs Snapshot",
  description: "Verifies compiler serialized boundary-graph.json and chunk-graph.json outputs",
  requires: ["graph"],
  async execute(lab, adapter, manifest) {
    // 1. Run production project compilation to get graphs
    const result = await lab.driver.compile("production");

    if (result.boundaryGraph) {
      const bgObj = serializeDeterministic(result.boundaryGraph);
      const bgContent = JSON.stringify(bgObj, null, 2);
      // Sanitize potential absolute paths inside boundary-graph
      const sanitizedBg = lab.pipeline.sanitizeCode(bgContent);
      const deterministicBg = JSON.stringify(JSON.parse(sanitizedBg), null, 2);
      await lab.assert.snapshot(`${manifest.name}/boundary-graph`, deterministicBg.trim());
    }

    if (result.chunkGraph) {
      const cgObj = serializeDeterministic(result.chunkGraph);
      const cgContent = JSON.stringify(cgObj, null, 2);
      const sanitizedCg = lab.pipeline.sanitizeCode(cgContent);
      const deterministicCg = JSON.stringify(JSON.parse(sanitizedCg), null, 2);
      await lab.assert.snapshot(`${manifest.name}/chunk-graph`, deterministicCg.trim());
    }
  },
};

executeProjectContract(graphContract, allManifests);
