import { describe, it, expect, vi } from "vite-plus/test";
import { handleHotUpdateHook } from "../hooks/hmr.js";

describe("HMR Integration", () => {
  const mockCtx: any = {
    compiler: {
      rootDir: "/root",
      isDev: true,
      _logger: {
        withPrefix: () => ({
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        }),
      },
      invalidateFile: vi.fn(),
      /**
       * Delegates the way the real one does: it takes custody of the update —
       * so a second environment pass for the same event joins rather than
       * re-running — and then performs exactly one invalidation. Keeping the
       * delegation here means the assertions below still describe what the
       * compiler is actually asked to do.
       */
      invalidateForUpdate: vi.fn((file: string, _seq: number, force?: boolean, content?: string) =>
        mockCtx.compiler.invalidateFile(file, force, content),
      ),
      getNormalizedId: (p: string) => p.replace("/root/", ""),
      isWritingFile: () => false,
      assets: {
        registerAsset: vi.fn(),
      },
      flush: async () => {},
      io: {
        getSafeBoundaryId: (p: string) => "safe_" + p.replace(/\//g, "_"),
      },
      getAffectedChunks: vi.fn().mockReturnValue(["entry:b1"]),
      graph: {
        boundaryGraph: {
          nodes: new Map([
            ["b1", { id: "b1", mode: "entry", filePath: "src/main.ts" }],
            ["b_assets", { id: "b_assets", mode: "boundary", filePath: "assets" }],
          ]),
        },
      },
    },
    options: {},
  };

  const mockServer: any = {
    moduleGraph: {
      idToModuleMap: new Map(),
      invalidateModule: vi.fn(),
      getModulesByFile: (file: string) => {
        const mods = [];
        for (const mod of mockServer.moduleGraph.idToModuleMap.values()) {
          if (mod.file === file) mods.push(mod);
        }
        return mods.length > 0 ? mods : null;
      },
    },
    ws: {
      send: vi.fn(),
    },
  };

  it("should handle asset changes by invalidating entries and proxies AND base files", async () => {
    const assetPath = "/root/src/about.txt";
    const mainPath = "/root/src/main.ts";

    const modules = [
      { id: assetPath, file: assetPath, importers: new Set() },
      { id: assetPath + "?raw", file: assetPath, importers: new Set() },
      { id: assetPath + "?zintl-raw", file: assetPath, importers: new Set() },
    ];

    mockServer.moduleGraph.idToModuleMap.set(assetPath, modules[0]);
    mockServer.moduleGraph.idToModuleMap.set(assetPath + "?raw", modules[1]);
    mockServer.moduleGraph.idToModuleMap.set(assetPath + "?zintl-raw", modules[2]);
    mockServer.moduleGraph.idToModuleMap.set(mainPath, {
      id: mainPath,
      file: mainPath,
      importers: new Set(),
    });
    mockServer.moduleGraph.idToModuleMap.set("virtual:zintl/manager/none/entry:b1", {
      id: "virtual:zintl/manager/none/entry:b1",
      importers: new Set(),
    });

    mockCtx.compiler.invalidateFile.mockReturnValue(["b_assets"]);

    const hook = handleHotUpdateHook(mockCtx);
    const result = await hook({
      file: assetPath,
      timestamp: Date.now(),
      modules: modules as any,
      read: async () => "",
      server: mockServer,
    });

    const resultIds = (result as any[]).map((m) => m.id);

    // 1. Should NOT contain the base asset path (this is the physical file that triggers reload)
    expect(resultIds).not.toContain(assetPath);

    // 2. Should contain the proxies (they are self-accepting and provide the new content)
    expect(resultIds).toContain(assetPath + "?raw");
    expect(resultIds).toContain(assetPath + "?zintl-raw");

    // 3. Entry point SHOULD be present (due to b_assets dependency)
    expect(resultIds).toContain(mainPath);

    // 4. Manager SHOULD be present
    expect(resultIds).toContain("virtual:zintl/manager/none/entry:b1");
  });

  it("should handle source code changes normally", async () => {
    const mainPath = "/root/src/main.ts";
    const modules = [{ id: mainPath, file: mainPath, importers: new Set() }];

    mockServer.moduleGraph.idToModuleMap.set(mainPath, modules[0]);
    mockCtx.compiler.invalidateFile.mockReturnValue(["b1"]);

    const hook = handleHotUpdateHook(mockCtx);
    const result = await hook({
      file: mainPath,
      timestamp: Date.now(),
      modules: modules as any,
      read: async () => "",
      server: mockServer,
    });

    const resultIds = (result as any[]).map((m) => m.id);
    expect(resultIds).toContain(mainPath);
  });

  it("should handle localized asset changes by invalidating entries", async () => {
    const localizedAssetPath = "/root/src/locales/src/about.ar.txt";
    const mainPath = "/root/src/main.ts";

    const modules = [{ id: localizedAssetPath, file: localizedAssetPath, importers: new Set() }];

    mockServer.moduleGraph.idToModuleMap.set(localizedAssetPath, modules[0]);
    mockServer.moduleGraph.idToModuleMap.set(mainPath, {
      id: mainPath,
      file: mainPath,
      importers: new Set(),
    });

    // Mock invalidateFile to return b_assets for the localized file
    mockCtx.compiler.invalidateFile.mockImplementation((file: string) => {
      if (file === localizedAssetPath) return ["b_assets"];
      return [];
    });

    const hook = handleHotUpdateHook(mockCtx);
    const result = await hook({
      file: localizedAssetPath,
      timestamp: Date.now(),
      modules: modules as any,
      read: async () => "",
      server: mockServer,
    });

    const resultIds = (result as any[]).map((m) => m.id);

    // Entry point SHOULD be present
    expect(resultIds).toContain(mainPath);
  });

  it("should handle Vue SFC source code changes and invalidate localized counterparts and the manager", async () => {
    const vuePath = "/root/src/components/HelloWorld.vue";
    const localizedVuePath = "/root/src/components/HelloWorld.zintl-ar.vue";
    const managerId = "\0virtual:zintl/manager/none/entry:b1";
    const modules = [{ id: vuePath, file: vuePath, importers: new Set() }];

    mockServer.moduleGraph.idToModuleMap.set(vuePath, modules[0]);
    mockServer.moduleGraph.idToModuleMap.set(localizedVuePath, {
      id: localizedVuePath,
      file: localizedVuePath,
      importers: new Set(),
    });
    mockServer.moduleGraph.idToModuleMap.set(managerId, {
      id: managerId,
      importers: new Set(),
    });

    mockCtx.compiler.invalidateFile.mockImplementation((file: string) => {
      if (file === vuePath) return ["b1"];
      return [];
    });

    const hook = handleHotUpdateHook(mockCtx);
    const result = await hook({
      file: vuePath,
      timestamp: Date.now(),
      modules: modules as any,
      read: async () => "",
      server: mockServer,
    });

    const resultIds = (result as any[]).map((m) => m.id);
    expect(resultIds).toContain(vuePath);
    expect(resultIds).toContain(localizedVuePath);
    expect(resultIds).toContain(managerId);
  });
});
