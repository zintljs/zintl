import { describe, it, expect } from "vite-plus/test";
import { CatalogManager } from "../managers/CatalogManager.js";
import { IOManager } from "../managers/IOManager.js";
import { logger } from "@zintl/extractor";

describe("CatalogManager", () => {
  it("should construct and heal ICU strings", () => {
    const io = new IOManager("/root", false, logger, {});
    const catalogMgr = new CatalogManager(
      io,
      "/root",
      "locales",
      "en",
      false,
      "[locale]/[dir]/[name].json",
      logger,
      true,
    );

    const healed = catalogMgr.healICUString("Hello {var1, plural, one {1} other {many}}", {
      var1: "var2",
    });
    expect(healed).toBe("Hello {var2, plural, one {1} other {many}}");
  });

  it("should prune orphaned boundaries early in dev mode outside of test env", async () => {
    const io = new IOManager("/root", false, logger, {});
    const catalogMgr = new CatalogManager(
      io,
      "/root",
      "locales",
      "en",
      true, // isDev = true
      "[locale]/[dir]/[name].json",
      logger,
      true,
    );

    // Mock environment to look like real dev mode without test runners
    const originalVitest = process.env.VITEST;
    const originalVitestWorker = process.env.VITEST_WORKER_ID;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    delete process.env.VITEST_WORKER_ID;
    process.env.NODE_ENV = "development";

    try {
      const graph = { nodes: new Map(), entries: new Set() };
      // Should early return and not run scan or anything
      await catalogMgr.pruneOrphanedBoundaries(graph as any, ["en", "ar"]);
      expect(catalogMgr["lastPrunedManifestHash"]).toBeNull();
    } finally {
      process.env.VITEST = originalVitest;
      process.env.VITEST_WORKER_ID = originalVitestWorker;
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("should early return if baseDir does not exist", async () => {
    const io = new IOManager("/root", false, logger, {});
    // Mock exists to return false
    io.exists = async () => false;

    const catalogMgr = new CatalogManager(
      io,
      "/root",
      "locales",
      "en",
      false,
      "[locale]/[dir]/[name].json",
      logger,
      true,
    );

    const graph = { nodes: new Map([["b1", {} as any]]), entries: new Set() };
    await catalogMgr.pruneOrphanedBoundaries(graph as any, ["en", "ar"]);
    expect(catalogMgr["lastPrunedManifestHash"]).toBeDefined();
  });

  it("should fallback to simple pruning when graphManager is undefined", async () => {
    const io = new IOManager("/root", false, logger, {});
    io.exists = async () => true;
    io.readEntries = async () => [];

    const catalogMgr = new CatalogManager(
      io,
      "/root",
      "locales",
      "en",
      false,
      "[locale]/[dir]/[name].json",
      logger,
      true,
    );

    const graph = {
      nodes: new Map([["b1", { mode: "entry", deps: [] } as any]]),
      entries: new Set(["b1"]),
    };
    const metadataGraph = {
      b1: {
        htmlProjection: { title: "title", dir: "ltr", scripts: [] },
      },
    };

    await catalogMgr.pruneOrphanedBoundaries(
      graph as any,
      ["en", "ar"],
      metadataGraph,
      undefined,
      undefined, // graphManager is undefined!
    );

    expect(catalogMgr["lastPrunedManifestHash"]).toBeDefined();
  });
});
