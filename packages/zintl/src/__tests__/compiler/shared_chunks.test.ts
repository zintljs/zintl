import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintl/compiler";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Zintl Compiler - Shared Chunks", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-test-");
    context.root = root;
    context.compiler = createTestCompiler(
      {
        locales: ["en", "ar"],
      },
      root,
      true,
    );
  });

  it("should detect a boundary shared by two entries", async (context: LocalContext) => {
    const { compiler } = context as { compiler: ZintlCompiler };
    // Mock extraction results for two entry points sharing a module
    // This is a shallow test: we manually populate the compiler state to trigger the algorithm

    const sharedId = "src/components/Button";
    const entry1Id = "src/pages/Home";
    const entry2Id = "src/pages/About";

    // Simulating internal state after transform() calls
    (compiler as any).internalManifest = {
      [sharedId]: [{ text: "Click me", id: "1", boundaryId: sharedId }],
      [entry1Id]: [{ text: "Welcome Home", id: "2", boundaryId: entry1Id }],
      [entry2Id]: [{ text: "About Us", id: "3", boundaryId: entry2Id }],
    };

    (compiler as any).dependencyGraph = {
      [entry1Id]: [{ id: sharedId, dynamic: false }],
      [entry2Id]: [{ id: sharedId, dynamic: false }],
      [sharedId]: [],
    };

    (compiler as any).metadataGraph = {
      [entry1Id]: {
        hasZintlMacro: true,
        isEntry: true,
        anchorSites: [{ isTopLevel: true, boundaryId: entry1Id }] as any,
        needsLoader: true,
      },
      [entry2Id]: {
        hasZintlMacro: true,
        isEntry: true,
        anchorSites: [{ isTopLevel: true, boundaryId: entry2Id }] as any,
        needsLoader: true,
      },
      [sharedId]: { hasZintlMacro: false, isEntry: false, anchorSites: [], needsLoader: false },
    };

    const graph = (compiler as any)._buildBoundaryGraph();
    (compiler as any).boundaryGraph = graph;
    (compiler as any)._computeUsageCounts(graph);
    const chunks = (compiler as any)._computeTranslationChunks(graph);

    expect(chunks.sharedChunks.size).toBe(1);
    const sharedChunkId = Array.from(chunks.sharedChunks)[0];
    expect(sharedChunkId).toBe(`shared_${compiler.getSafeBoundaryId(sharedId)}`);
  });

  it("should treat dynamic imports as lazy entry points", (context: LocalContext) => {
    const { compiler } = context as { compiler: ZintlCompiler };
    const entryId = "src/main";
    const lazyId = "src/LazyComponent";

    (compiler as any).internalManifest = {
      [entryId]: [],
      [lazyId]: [{ text: "Lazy", id: "1" }],
    };

    (compiler as any).dependencyGraph = {
      [entryId]: [{ id: lazyId, dynamic: true }],
      [lazyId]: [],
    };

    (compiler as any).metadataGraph = {
      [entryId]: {
        hasZintlMacro: true,
        isEntry: true,
        anchorSites: [{ isTopLevel: true, boundaryId: entryId }] as any,
        needsLoader: true,
      },
      [lazyId]: { hasZintlMacro: false, isEntry: false, anchorSites: [], needsLoader: false },
    };

    const graph = (compiler as any)._buildBoundaryGraph();
    (compiler as any)._computeUsageCounts(graph);
    const chunks = (compiler as any)._computeTranslationChunks(graph);

    expect(chunks.lazyChunks.size).toBe(1);
    const lazyChunkId = Array.from(chunks.lazyChunks)[0];
    expect(lazyChunkId).toBe(`lazy_${compiler.getSafeBoundaryId(lazyId)}`);
  });
});
