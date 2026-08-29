import { describe, it, expect } from "vite-plus/test";
import { GraphManager } from "../managers/GraphManager.js";
import { IOManager } from "../managers/IOManager.js";
import { logger } from "@zintljs/extractor";
import type { BoundaryMetadata, ObservedDependency } from "../types.ts";
import type { ManifestEntry } from "../reconcile.js";

const ZERO_LOCATION = { start: 0, end: 0, line: 0, column: 0 };
const entry = (key: string, boundaryId: string): ManifestEntry => ({
  id: key,
  text: key,
  context: "",
  boundaryId,
  location: ZERO_LOCATION,
});

describe("GraphManager", () => {
  it("should construct and build a simple boundary graph", () => {
    const io = new IOManager("/root", false, logger, {}, [], []);
    const graphMgr = new GraphManager(io, false, logger, ["en", "ar"]);

    const internalManifest = {
      "src/main": [entry("key1", "src/main")],
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
      "index.html": [entry("key_html", "index.html")],
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

  /**
   * A production compile must not inherit a dev-only virtual boundary from a
   * persisted `.zintl` manifest. It used to: `manifest["b_assets"]` and
   * `metadata["b_assets"]` are written in dev and kept on disk, and the
   * candidate-seeding loop read them back, so a build grew a `b_assets` node
   * whenever a dev run had touched the same project first. That made a
   * serialized-graph snapshot a function of test ordering rather than of the
   * source.
   */
  it("does not build a virtual boundary node from persisted dev metadata in a build", () => {
    const persistedManifest = {
      "src/main": [entry("key1", "src/main")],
      b_assets: [entry("@zintl/asset:src/about.txt", "b_assets")],
    };
    const persistedMetadata: Record<string, BoundaryMetadata> = {
      "src/main": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: true,
        anchorSites: [],
        needsLoader: false,
        exportedBoundaries: {},
        internalDependencies: {},
      },
      b_assets: {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: false,
        anchorSites: [],
        needsLoader: false,
        exportedBoundaries: {},
        internalDependencies: {},
      },
    };

    const build = new GraphManager(
      new IOManager("/root", false, logger, {}, [], []),
      false,
      logger,
      ["en", "ar"],
    );
    const buildGraph = build.buildBoundaryGraph(persistedManifest, persistedMetadata, {}, [
      "b_assets",
    ]);
    expect(buildGraph.nodes.has("b_assets")).toBe(false);
    expect(buildGraph.nodes.has("src/main")).toBe(true);

    // Dev still synthesizes it, and with its own shape — `virtual-content`,
    // not the id — which is what makes the leaked node identifiable.
    const dev = new GraphManager(new IOManager("/root", true, logger, {}), true, logger, [
      "en",
      "ar",
    ]);
    const devGraph = dev.buildBoundaryGraph(persistedManifest, persistedMetadata, {}, ["b_assets"]);
    expect(devGraph.nodes.has("b_assets")).toBe(true);
  });

  it("does not build a node from a manifest key whose anchor has since moved", () => {
    /**
     * `f_<offset>` renames itself whenever anything above the call is edited,
     * so a persisted manifest accumulates keys for anchors that no longer
     * exist. The file still imports the macro, so the pass-through rule keeps
     * such a key alive unless the seeding loop rejects it first.
     */
    const persistedManifest = {
      "src/Switcher:f_700": [],
      "src/Switcher:f_846": [],
    };
    const persistedMetadata: Record<string, BoundaryMetadata> = {
      "src/Switcher": {
        hasZintlMacro: true,
        hasZintlMarker: false,
        isEntry: false,
        anchorSites: [
          {
            boundaryId: "src/Switcher:f_846",
            locale: { type: "expression", source: "lang" },
            isTopLevel: false,
            location: ZERO_LOCATION,
            scope: "function",
            originalName: "src/Switcher:f_846",
          },
        ],
        needsLoader: false,
        exportedBoundaries: {},
        internalDependencies: {},
      },
    };
    const dependencyGraph: Record<string, ObservedDependency[]> = {
      "src/Switcher": [{ id: "zintljs/macro", dynamic: false, bindings: ["zintl"] }],
    };

    const graphMgr = new GraphManager(
      new IOManager("/root", false, logger, {}, [], []),
      false,
      logger,
      ["en", "ar"],
    );
    const graph = graphMgr.buildBoundaryGraph(
      persistedManifest,
      persistedMetadata,
      dependencyGraph,
    );

    expect(graph.nodes.has("src/Switcher:f_700")).toBe(false);
    expect(graph.nodes.has("src/Switcher:f_846")).toBe(true);
  });

  it("keeps an unattested nested boundary that still carries translations", () => {
    /**
     * The counterpart to the test above: a partial rebuild re-extracts one
     * file, so metadata attests nothing about the rest. A key holding real
     * strings is a boundary whose file was not read this pass, not a ghost —
     * dropping it would drop translations.
     */
    const persistedManifest = {
      "src/Legacy:helper": [entry("key1", "src/Legacy:helper")],
    };
    const persistedMetadata: Record<string, BoundaryMetadata> = {
      "src/Legacy": {
        hasZintlMacro: false,
        hasZintlMarker: false,
        isEntry: false,
        anchorSites: [],
        needsLoader: false,
        exportedBoundaries: {},
        internalDependencies: {},
      },
    };

    const graphMgr = new GraphManager(
      new IOManager("/root", false, logger, {}, [], []),
      false,
      logger,
      ["en", "ar"],
    );
    const graph = graphMgr.buildBoundaryGraph(persistedManifest, persistedMetadata, {});

    expect(graph.nodes.has("src/Legacy:helper")).toBe(true);
  });

  it("should cover leadsToBoundary branches: sovereign/contextual anchors and early returns", () => {
    const io = new IOManager("/root", false, logger, {}, [], []);
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
    const io = new IOManager("/root", false, logger, {}, [], []);
    const graphMgr = new GraphManager(io, false, logger, ["en", "ar"]);

    const internalManifest = {
      "src/entry": [entry("key1", "src/entry")],
      "src/shared": [entry("key2", "src/shared")],
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

/**
 * `hasTranslatableContent` had no coverage at all until this file, which is
 * part of why L-002b survived: the walk was moved out of the Vite plugin
 * verbatim, and nothing asserted what it did with an import shape the plugin
 * had never been given.
 *
 * The predicate's failure direction is the asymmetric one. "Neutral" means
 * "needs no per-locale copy", so a false positive silently drops a module's
 * translations, while a false negative only costs a redundant copy.
 */
describe("GraphManager.hasTranslatableContent", () => {
  const NO_ASSETS = () => false;

  /** A file with strings in it, and nothing else. */
  const withContent = (): BoundaryMetadata => ({
    hasZintlMacro: false,
    hasZintlMarker: false,
    isEntry: false,
    anchorSites: [],
    needsLoader: true,
    exportedBoundaries: {},
    internalDependencies: {},
  });

  const inert = (): BoundaryMetadata => ({ ...withContent(), needsLoader: false });

  const setup = () => {
    const io = new IOManager("/root", false, logger, {}, [".ts", ".tsx"], []);
    return new GraphManager(io, false, logger, ["en", "ar"]);
  };

  it("follows an extensionless relative import to the file it means", () => {
    const graphMgr = setup();
    // `src/main` imports `./counter`, which is really `src/counter.ts` — the
    // shape every TypeScript project uses and the one L-002b walked past.
    const dependencyGraph = {
      "src/main": [{ id: "./counter" }] as unknown as ObservedDependency[],
      "src/counter.ts": [] as unknown as ObservedDependency[],
    };
    const metadataGraph: Record<string, BoundaryMetadata> = {
      "src/main": inert(),
      "src/counter.ts": withContent(),
    };

    expect(
      graphMgr.hasTranslatableContent("src/main", dependencyGraph, metadataGraph, {}, NO_ASSETS),
    ).toBe(true);
  });

  it("still reports a genuinely inert graph as having nothing", () => {
    const graphMgr = setup();
    const dependencyGraph = {
      "src/main": [{ id: "./counter" }] as unknown as ObservedDependency[],
      "src/counter.ts": [] as unknown as ObservedDependency[],
    };
    const metadataGraph: Record<string, BoundaryMetadata> = {
      "src/main": inert(),
      "src/counter.ts": inert(),
    };

    expect(
      graphMgr.hasTranslatableContent("src/main", dependencyGraph, metadataGraph, {}, NO_ASSETS),
    ).toBe(false);
  });

  it("finds content whose only evidence is a manifest entry", () => {
    const graphMgr = setup();
    /**
     * `src/about.ts` is present in the dependency graph, which is how a real
     * project looks: a file with extracted messages is also a node. Resolution
     * uses exact lookups for speed, so the manifest's `<file>:<boundary>` keys
     * are matched by content discovery rather than by resolution — the split
     * that keeps the HMR budgets intact.
     */
    const dependencyGraph = {
      "src/main": [{ id: "./about" }] as unknown as ObservedDependency[],
      "src/about.ts": [] as unknown as ObservedDependency[],
    };
    const internalManifest = { "src/about.ts:body": [entry("hello", "src/about.ts:body")] };

    expect(
      graphMgr.hasTranslatableContent(
        "src/main",
        dependencyGraph,
        { "src/main": inert() },
        internalManifest,
        NO_ASSETS,
      ),
    ).toBe(true);
  });

  it("terminates on a dependency cycle", () => {
    const graphMgr = setup();
    const dependencyGraph = {
      "src/a.ts": [{ id: "./b" }] as unknown as ObservedDependency[],
      "src/b.ts": [{ id: "./a" }] as unknown as ObservedDependency[],
    };
    const metadataGraph: Record<string, BoundaryMetadata> = {
      "src/a.ts": inert(),
      "src/b.ts": inert(),
    };

    expect(
      graphMgr.hasTranslatableContent("src/a.ts", dependencyGraph, metadataGraph, {}, NO_ASSETS),
    ).toBe(false);
  });
});

/**
 * Both cases were found by the documentation site's navigation tree — a data
 * module whose titles are prose. Each one produced the same silent failure: a
 * catalog written and filled on disk, `verifyIntegrity` green because the file
 * was complete, and the strings rendering pseudo-localized in dev and **empty
 * in production**, because no walk over the boundary graph could reach the
 * boundary that held them.
 */
describe("GraphManager — an export reaches the strings it calls", () => {
  const meta = (over: Partial<BoundaryMetadata> = {}): BoundaryMetadata => ({
    hasZintlMacro: false,
    hasZintlMarker: false,
    isEntry: false,
    anchorSites: [],
    needsLoader: false,
    exportedBoundaries: {},
    internalDependencies: {},
    ...over,
  });

  const reachable = (graph: ReturnType<GraphManager["buildBoundaryGraph"]>, from: string) => {
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      const node = graph.nodes.get(id);
      if (!node) return;
      seen.add(id);
      for (const dep of node.deps) if (!dep.dynamic) walk(dep.id);
    };
    walk(from);
    return seen;
  };

  it("keeps an export with internal dependencies as a pass-through node", () => {
    const io = new IOManager("/root", false, logger, {}, [], []);
    const graphMgr = new GraphManager(io, false, logger, ["en", "ar"]);

    // `function nav() { return { title: "Guide" } }` — the strings sit on a
    // function boundary, and the exported function only *calls* it. The file
    // imports nothing, which is what used to delete the intermediate node.
    const internalManifest = {
      "src/main": [entry("k_main", "src/main")],
      "src/nav:nav": [entry("Guide", "src/nav:nav")],
    };
    const metadataGraph: Record<string, BoundaryMetadata> = {
      "src/main": meta({
        isEntry: true,
        anchorSites: [
          {
            boundaryId: "src/main",
            locale: { type: "expression", source: "locale" },
            isTopLevel: true,
            location: { start: 1, end: 1, line: 1, column: 1 },
            scope: "module",
            originalName: "src/main",
          },
        ],
      }),
      "src/nav": meta({
        exportedBoundaries: { getSections: "src/nav:getSections" },
        internalDependencies: { "src/nav:getSections": ["src/nav:nav"] },
      }),
    };
    const dependencyGraph: Record<string, ObservedDependency[]> = {
      "src/main": [{ id: "src/nav", dynamic: false, bindings: ["getSections"] }],
      "src/nav": [],
    };

    const graph = graphMgr.buildBoundaryGraph(internalManifest, metadataGraph, dependencyGraph);

    expect(graph.nodes.has("src/nav:getSections")).toBe(true);
    expect(reachable(graph, "src/main").has("src/nav:nav")).toBe(true);
  });
});
