import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
import { join } from "node:path";

describe("Catalog HMR Integration", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    ctx = await createZintlContext({
      isDev: true,
      locales: ["en", "ar"],
      outputDir: "locales",
      logLevel: "debug",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("should invalidate the source module and multiplexed variant when a catalog file of a contextual anchor is updated", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup a contextual anchor in src/main.ts
    const code = `import { zintl, t } from "zintl"; zintl("en"); console.log(t("Hello"));`;
    await ctx.setupFile("src/main.ts", code);

    await compiler.discover();
    const filePath = join(root, "src/main.ts");
    await compiler.transform(code, filePath);
    await compiler.flush();
    compiler.io.writingFiles.clear();

    const catalogPath = compiler.catalog.getCatalogPath("src/main", "ar");
    expect(await compiler.io.exists(catalogPath)).toBe(true);

    // 2. Setup mock module graph with multiplexed variant
    const mockModule = { id: "/src/main.ts?zintl-multiplex=ar", file: filePath };
    const mockModuleBare = { id: "/src/main.ts", file: filePath };
    const mockVirtualMod = { id: "virtual:zintl/content/ar/entry:b_src_main", file: null };

    const moduleMap = new Map<string, any>([
      ["/src/main.ts?zintl-multiplex=ar", mockModule],
      ["/src/main.ts", mockModuleBare],
      ["virtual:zintl/content/ar/entry:b_src_main", mockVirtualMod],
    ]);

    const mockServer = {
      config: { root },
      moduleGraph: {
        idToModuleMap: moduleMap,
        getModuleById: vi.fn(),
        invalidateModule: vi.fn(),
      },
      ws: { send: vi.fn() },
    };

    // 3. Trigger HMR on catalog update
    let result: any[] = [];
    if (plugin.handleHotUpdate) {
      result = (await plugin.handleHotUpdate({
        file: catalogPath,
        timestamp: Date.now(),
        modules: [],
        read: () => "",
        server: mockServer as any,
      })) as any[];
    }

    // 4. Assert invalidations are performed on source and multiplexed module
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockModule);
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockModuleBare);

    // Virtual module invalidation check
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockVirtualMod);

    // Ensure they are returned to force Vite's HMR system update
    const returnedIds = result.map((m) => m.id);
    expect(returnedIds).toContain("/src/main.ts?zintl-multiplex=ar");
    expect(returnedIds).toContain("/src/main.ts");
    expect(returnedIds).toContain("virtual:zintl/content/ar/entry:b_src_main");
  });

  it("should invalidate the source module when a catalog file of a sovereign anchor is updated", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup a sovereign anchor in src/main.ts
    const code = `import { zintl, t } from "zintl"; zintl("*"); console.log(t("Hello"));`;
    await ctx.setupFile("src/main.ts", code);

    await compiler.discover();
    const filePath = join(root, "src/main.ts");
    await compiler.transform(code, filePath);
    await compiler.flush();
    compiler.io.writingFiles.clear();

    const catalogPath = compiler.catalog.getCatalogPath("src/main", "ar");
    expect(await compiler.io.exists(catalogPath)).toBe(true);

    // 2. Setup mock module graph
    const mockModule = { id: "/src/main.ts?zintl-multiplex=ar", file: filePath };
    const mockModuleBare = { id: "/src/main.ts", file: filePath };
    const mockVirtualMod = { id: "virtual:zintl/content/ar/entry:b_src_main", file: null };

    const moduleMap = new Map<string, any>([
      ["/src/main.ts?zintl-multiplex=ar", mockModule],
      ["/src/main.ts", mockModuleBare],
      ["virtual:zintl/content/ar/entry:b_src_main", mockVirtualMod],
    ]);

    const mockServer = {
      config: { root },
      moduleGraph: {
        idToModuleMap: moduleMap,
        getModuleById: vi.fn(),
        invalidateModule: vi.fn(),
      },
      ws: { send: vi.fn() },
    };

    // 3. Trigger HMR on catalog update
    let result: any[] = [];
    if (plugin.handleHotUpdate) {
      result = (await plugin.handleHotUpdate({
        file: catalogPath,
        timestamp: Date.now(),
        modules: [],
        read: () => "",
        server: mockServer as any,
      })) as any[];
    }

    // 4. Assert invalidations
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockModule);
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockModuleBare);
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockVirtualMod);

    const returnedIds = result.map((m) => m.id);
    expect(returnedIds).toContain("/src/main.ts?zintl-multiplex=ar");
    expect(returnedIds).toContain("/src/main.ts");
    expect(returnedIds).toContain("virtual:zintl/content/ar/entry:b_src_main");
  });
});
