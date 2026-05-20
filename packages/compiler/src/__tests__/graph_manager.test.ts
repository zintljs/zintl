import { describe, it, expect } from "vite-plus/test";
import { GraphManager } from "../managers/GraphManager.js";
import { IOManager } from "../managers/IOManager.js";
import { logger } from "@zintl/extractor";
import type { BoundaryMetadata, ObservedDependency } from "../types.ts";

describe("GraphManager", () => {
  it("should construct and build a simple boundary graph", () => {
    const io = new IOManager("/root", false, logger, {});
    const graphMgr = new GraphManager(io, false, logger, ["en", "ar"]);

    const internalManifest = {
      "src/main": ["key1"],
    };

    const metadataGraph: Record<string, BoundaryMetadata> = {
      "src/main": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: true,
        anchorSites: [
          {
            boundaryId: "src/main",
            locale: { type: "literal", value: "en" },
            isTopLevel: true,
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/main",
          },
        ],
        needsLoader: false,
        exportedBoundaries: {},
        internalDependencies: {},
      },
    };

    const dependencyGraph: Record<string, ObservedDependency[]> = {
      "src/main": [{ id: "src/dep", dynamic: false, bindings: [] }],
    };

    const graph = graphMgr.buildBoundaryGraph(internalManifest, metadataGraph, dependencyGraph);

    expect(graph).toBeDefined();
    expect(graph.entries.has("src/main")).toBe(true);
  });

  it("should cover isDictator for HTML projection and isDev b_assets injection", () => {
    const io = new IOManager("/root", true, logger, {});
    // dev mode = true
    const graphMgr = new GraphManager(io, true, logger, ["en", "ar"]);

    const internalManifest = {
      "index.html": ["key_html"],
      "src/main": [],
    };

    //     export interface BoundaryMetadata {
    //   hasZintlMacro: boolean;
    //   hasZintlMarker: boolean;
    //   isEntry: boolean;
    //   anchorSites: ObservedAnchor[];
    //   needsLoader: boolean;
    //   exportedBoundaries: Record<string, string>;
    //   internalDependencies: Record<string, string[]>;
    //   htmlProjection?: HtmlProjectionPayload;
    // }

    const metadataGraph: Record<string, BoundaryMetadata> = {
      "index.html": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: true,
        needsLoader: true,
        anchorSites: [
          {
            boundaryId: "index.html",
            locale: { type: "literal", value: "en" },
            isTopLevel: true,
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "index.html",
          },
        ],
        exportedBoundaries: {},
        internalDependencies: {},
        htmlProjection: { scripts: ["src/main.ts"] },
      },
      "src/main": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: false,
        needsLoader: false,
        anchorSites: [
          {
            boundaryId: "index.html",
            locale: { type: "literal", value: "en" },
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/main",
            isTopLevel: false,
          },
        ],
        exportedBoundaries: {},
        internalDependencies: {},
      },
    };
    const dependencyGraph: Record<string, ObservedDependency[]> = {
      "index.html": [{ id: "src/main", dynamic: false, bindings: [] }],
      "src/main": [],
    };

    const graph = graphMgr.buildBoundaryGraph(internalManifest, metadataGraph, dependencyGraph);

    expect(graph).toBeDefined();

    // Verify chunk compilation inserts b_assets in dev mode
    const chunkGraph = graphMgr.computeTranslationChunks(graph, internalManifest, metadataGraph);
    expect(chunkGraph).toBeDefined();
    const entryChunk = chunkGraph.chunks.get("entry_b_index_html");
    expect(entryChunk).toBeDefined();
    expect(entryChunk?.boundaries).toContain("b_assets");
  });

  it("should cover leadsToBoundary branches: sovereign/contextual anchors and early returns", () => {
    const io = new IOManager("/root", false, logger, {});
    const graphMgr = new GraphManager(io, false, logger, ["en", "ar"]);

    const internalManifest = {
      "src/entry": [],
      "src/sub": [],
      "src/sovereign": [],
    };

    //     export interface BoundaryMetadata {
    //   hasZintlMacro: boolean;
    //   hasZintlMarker: boolean;
    //   isEntry: boolean;
    //   anchorSites: ObservedAnchor[];
    //   needsLoader: boolean;
    //   exportedBoundaries: Record<string, string>;
    //   internalDependencies: Record<string, string[]>;
    //   htmlProjection?: HtmlProjectionPayload;
    // }
    const metadataGraph: Record<string, BoundaryMetadata> = {
      "src/entry": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: true,
        needsLoader: false,
        anchorSites: [
          {
            boundaryId: "src/entry",
            locale: { type: "literal", value: "en" },
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/entry",
            isTopLevel: true,
          },
        ],
        exportedBoundaries: {},
        internalDependencies: {},
      },
      "src/sub": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: false,
        needsLoader: false,
        anchorSites: [
          {
            boundaryId: "src/sub",
            locale: { type: "literal", value: "en" },
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/sub",
            isTopLevel: false,
          },
        ],
        exportedBoundaries: {},
        internalDependencies: {},
      },
      "src/sovereign": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: false,
        needsLoader: false,
        anchorSites: [
          {
            boundaryId: "src/sovereign",
            locale: { type: "literal", value: "*" },
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/sovereign",
            isTopLevel: false,
          },
        ],
        exportedBoundaries: {},
        internalDependencies: {},
      },
    };
    const dependencyGraph: Record<string, ObservedDependency[]> = {
      "src/entry": [
        { id: "src/sub", dynamic: false, bindings: [] },
        { id: "src/sovereign", dynamic: true, bindings: [] },
      ],
      "src/sub": [],
      "src/sovereign": [],
    };

    const graph = graphMgr.buildBoundaryGraph(internalManifest, metadataGraph, dependencyGraph);

    expect(graph).toBeDefined();
    const leads = graphMgr["leadsToBoundary"](
      "src/entry",
      dependencyGraph,
      metadataGraph,
      new Set(),
    );
    expect(leads.leads).toBe(true);

    const leadsSovereign = graphMgr["leadsToBoundary"](
      "src/sovereign",
      dependencyGraph,
      metadataGraph,
      new Set(),
    );
    expect(leadsSovereign.leads).toBe(true);
    expect(leadsSovereign.bakedLocale).toBe("*");
  });

  it("should propagate active locales and compute usage counts", () => {
    const io = new IOManager("/root", false, logger, {});
    const graphMgr = new GraphManager(io, false, logger, ["en", "ar"]);

    const internalManifest = {
      "src/entry": ["key1"],
      "src/shared": ["key2"],
    };
    const metadataGraph: Record<string, BoundaryMetadata> = {
      "src/entry": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: true,
        needsLoader: false,
        anchorSites: [
          {
            boundaryId: "src/entry",
            locale: { type: "literal", value: "ar" },
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/entry",
            isTopLevel: true,
          },
        ],
        exportedBoundaries: {},
        internalDependencies: {},
      },
      "src/shared": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: false,
        needsLoader: false,
        anchorSites: [
          {
            boundaryId: "src/shared",
            locale: { type: "literal", value: "ar" },
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/shared",
            isTopLevel: false,
          },
        ],
        exportedBoundaries: {},
        internalDependencies: {},
      },
    };
    const dependencyGraph: Record<string, ObservedDependency[]> = {
      "src/entry": [{ id: "src/shared", dynamic: false, bindings: [] }],
      "src/shared": [],
    };

    const graph = graphMgr.buildBoundaryGraph(internalManifest, metadataGraph, dependencyGraph);
    // const chunkGraph = graphMgr.computeTranslationChunks(graph, internalManifest, metadataGraph);
    const usage = graphMgr.computeUsageCounts(graph);

    expect(usage).toBeDefined();
  });
});
