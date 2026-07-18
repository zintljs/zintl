import { executeProjectContract, type Contract } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    const mapped = obj.map(sortObjectKeys);
    if (mapped.every((item) => typeof item === "string")) {
      return mapped.sort();
    }
    return mapped;
  }
  const sorted: any = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys(obj[key]);
  }
  return sorted;
}

function serializeGraph(val: any): any {
  if (val === null || typeof val !== "object") {
    return val;
  }
  if (val instanceof Map) {
    const obj: any = {};
    for (const [key, value] of val.entries()) {
      obj[key] = serializeGraph(value);
    }
    return obj;
  }
  if (val instanceof Set) {
    return Array.from(val).map(serializeGraph);
  }
  if (Array.isArray(val)) {
    return val.map(serializeGraph);
  }
  const obj: any = {};
  for (const [key, value] of Object.entries(val)) {
    obj[key] = serializeGraph(value);
  }
  return obj;
}

export const graphContract: Contract = {
  name: "Serialized Graphs Snapshot",
  description: "Verifies compiler serialized boundary-graph.json and chunk-graph.json outputs",
  requires: ["graph"],
  async execute(lab, adapter, manifest) {
    // 1. Run production project compilation to get graphs
    const result = await lab.driver.compile("production");

    if (result.boundaryGraph) {
      const bgObj = serializeGraph(result.boundaryGraph);
      const bgContent = JSON.stringify(bgObj, null, 2);
      // Sanitize potential absolute paths inside boundary-graph
      const sanitizedBg = lab.pipeline.sanitizeCode(bgContent);
      const deterministicBg = JSON.stringify(sortObjectKeys(JSON.parse(sanitizedBg)), null, 2);
      await lab.assert.snapshot(`${manifest.name}/boundary-graph`, deterministicBg.trim());
    }

    if (result.chunkGraph) {
      const cgObj = serializeGraph(result.chunkGraph);
      const cgContent = JSON.stringify(cgObj, null, 2);
      const sanitizedCg = lab.pipeline.sanitizeCode(cgContent);
      const deterministicCg = JSON.stringify(sortObjectKeys(JSON.parse(sanitizedCg)), null, 2);
      await lab.assert.snapshot(`${manifest.name}/chunk-graph`, deterministicCg.trim());
    }
  },
};

executeProjectContract(graphContract, allManifests);
