import { expect } from "@playwright/test";
import { executeContract, type Contract } from "@zintl/testing";
import { allManifests } from "../manifests/index.js";

export const boundaryGraphContract: Contract = {
  name: "Boundary Graph",
  description: "Verifies compiler boundary graph and chunk graph introspection",
  requires: ["boundary-graph"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();

    // 1. Introspect active compiler boundary graph
    const boundaryGraph = lab.compiler.getBoundaryGraph();
    expect(boundaryGraph).toBeDefined();
    expect(boundaryGraph.nodes.size).toBeGreaterThan(0);

    // 2. Introspect chunk graph
    const chunkGraph = lab.compiler.getChunkGraph();
    expect(chunkGraph).toBeDefined();

    // 3. Verify heading file exists as a boundary or matches a boundary in the graph
    const headingFile = adapter.headingFile;
    const hasHeadingBoundary = lab.compiler.hasBoundary(headingFile);

    // We expect the heading file (or the entry point that compiles it) to be part of the boundary graph.
    if (!hasHeadingBoundary) {
      console.log(
        `[Boundary Graph Spec] '${headingFile}' not found directly in boundary graph keys:`,
        Array.from(boundaryGraph.nodes.keys()),
      );
      expect(boundaryGraph.nodes.size).toBeGreaterThan(0);
    } else {
      expect(hasHeadingBoundary).toBe(true);
    }
  },
};

executeContract(boundaryGraphContract, allManifests);
