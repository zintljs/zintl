import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A translator editing a catalog — which is what every test here is about.
 *
 * These used to fire the hot-update hook without touching the file, after
 * clearing `writingFiles` by hand. What reached the hook was then the
 * compiler's *own* flush coming back, and the invalidations they assert were
 * the compiler chasing its own write. The hook now recognises that by content
 * and declines it, so the edit has to be real.
 */
async function handEdit(compiler: any, catalogPath: string) {
  const current = JSON.parse(await readFile(catalogPath, "utf-8"));
  const [key] = Object.keys(current);
  if (key) current[key] = `${String(current[key] ?? "")} (edited)`;
  await writeFile(catalogPath, JSON.stringify(current, null, 2), "utf-8");
  compiler.io.writingFiles.clear();
}

describe("Catalog HMR Integration", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    ctx = await createZintlContext({
      isDev: true,
      locales: ["en", "ar"],
      outputDir: "locales",
      logLevel: "debug",
      /** One test here synthesizes a React app, so the project declares React. */
      dependencies: { react: "^19.0.0" },
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("should invalidate the source module and multiplexed variant when a catalog file of a contextual anchor is updated", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup a contextual anchor in src/main.ts
    const code = `import { zintl, t } from "zintljs"; zintl("en"); console.log(t("Hello"));`;
    await ctx.setupFile("src/main.ts", code);

    await compiler.discover();
    const filePath = join(root, "src/main.ts");
    await compiler.transform(code, filePath);
    await compiler.flush();

    const catalogPath = compiler.catalog.getCatalogPath("src/main", "ar");
    expect(await compiler.io.exists(catalogPath)).toBe(true);
    await handEdit(compiler, catalogPath);

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
    const code = `import { zintl, t } from "zintljs"; zintl("*"); console.log(t("Hello"));`;
    await ctx.setupFile("src/main.ts", code);

    await compiler.discover();
    const filePath = join(root, "src/main.ts");
    await compiler.transform(code, filePath);
    await compiler.flush();

    const catalogPath = compiler.catalog.getCatalogPath("src/main", "ar");
    expect(await compiler.io.exists(catalogPath)).toBe(true);
    await handEdit(compiler, catalogPath);

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

  it("should invalidate the nested entry manager in a React-like bootstrap setup when a component catalog is updated", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup src/main.tsx with bootstrap zintl call, and src/App.tsx with text
    const mainCode = `
      import { zintl } from "zintljs";
      import { App } from "./App";
      async function bootstrap() {
        await zintl("en");
        console.log(App);
      }
      bootstrap();
    `;
    const appCode = `
      import { t } from "zintljs";
      export function App() {
        return <div>{t("Hello World")}</div>;
      }
    `;

    await ctx.setupFile("src/main.tsx", mainCode);
    await ctx.setupFile("src/App.tsx", appCode);

    await compiler.discover();
    const mainPath = join(root, "src/main.tsx");
    const appPath = join(root, "src/App.tsx");

    await compiler.transform(mainCode, mainPath);
    await compiler.transform(appCode, appPath);
    await compiler.flush();

    const catalogPath = compiler.catalog.getCatalogPath("src/App.tsx:App", "ar");
    expect(await compiler.io.exists(catalogPath)).toBe(true);
    await handEdit(compiler, catalogPath);

    // 2. Setup mock module graph
    const mockAppMod = { id: "/src/App.tsx", file: appPath };
    const mockManagerMod = {
      id: "virtual:zintl/manager/none/entry:b_src_main_tsx_bootstrap",
      file: null,
    };
    const mockContentMod = {
      id: "virtual:zintl/content/ar/entry:b_src_main_tsx_bootstrap",
      file: null,
    };

    const moduleMap = new Map<string, any>([
      ["/src/App.tsx", mockAppMod],
      ["virtual:zintl/manager/none/entry:b_src_main_tsx_bootstrap", mockManagerMod],
      ["virtual:zintl/content/ar/entry:b_src_main_tsx_bootstrap", mockContentMod],
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

    // 3. Trigger HMR on catalog update of App
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

    const returnedIds = result.map((m) => m.id);
    expect(returnedIds).toContain("virtual:zintl/manager/none/entry:b_src_main_tsx_bootstrap");
    expect(returnedIds).toContain("virtual:zintl/content/ar/entry:b_src_main_tsx_bootstrap");
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockManagerMod);
    expect(mockServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(mockContentMod);
  });
});
