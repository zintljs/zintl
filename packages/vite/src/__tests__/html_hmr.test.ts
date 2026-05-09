import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
import { join } from "node:path";

describe("HTML HMR", () => {
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

  it("should trigger full-reload when an HTML catalog is modified", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup an HTML file and its script
    await ctx.setupFile("src/main.ts", `import { zintl } from "zintl"; zintl("en");`);
    const htmlCode = `<html><head><title>HMR Test</title><script src="/src/main.ts"></script></head></html>`;
    await ctx.setupFile("index.html", htmlCode);

    // Initial discovery
    await compiler.discover();
    const htmlPath = join(root, "index.html");
    await compiler.transform(htmlCode, htmlPath);
    await compiler.flush();
    compiler.io.writingFiles.clear();

    const catalogPath = join(root, "locales", "index.html.ar.json");
    expect(await compiler.io.exists(catalogPath)).toBe(true);

    // 2. Mock Vite server and handleHotUpdate
    const wsSend = vi.fn();
    const mockServer = {
      config: { root },
      moduleGraph: {
        idToModuleMap: new Map(),
        getModuleById: vi.fn(),
        invalidateModule: vi.fn(),
      },
      ws: { send: wsSend },
    };

    // Trigger HMR for the catalog file
    if (plugin.handleHotUpdate) {
      await plugin.handleHotUpdate({
        file: catalogPath,
        timestamp: Date.now(),
        modules: [],
        read: () => "",
        server: mockServer as any,
      });
    }

    // 3. Verify that full-reload was sent
    expect(wsSend).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  });

  it("should NOT trigger full-reload for standard boundary updates", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup a standard boundary
    const tsCode = `import { zintl } from "zintl"; zintl("en"); console.log("Hello");`;
    await ctx.setupFile("src/main.ts", tsCode);

    await compiler.discover();
    await compiler.flush();
    compiler.io.writingFiles.clear();

    const catalogPath = compiler.catalog.getCatalogPath("src/main", "ar");

    // 2. Mock Vite server
    const wsSend = vi.fn();
    const mockServer = {
      config: { root },
      moduleGraph: {
        idToModuleMap: new Map(),
        getModuleById: vi.fn(),
        invalidateModule: vi.fn(),
      },
      ws: { send: wsSend },
    };

    // Trigger HMR for the catalog file
    if (plugin.handleHotUpdate) {
      await plugin.handleHotUpdate({
        file: catalogPath,
        timestamp: Date.now(),
        modules: [],
        read: () => "",
        server: mockServer as any,
      });
    }

    // 3. Verify that full-reload was NOT sent
    expect(wsSend).not.toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  });

  it("should trigger full-reload when the source HTML file is modified", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup an HTML file and its script
    await ctx.setupFile("src/main.ts", `import { zintl } from "zintl"; zintl("en");`);
    const htmlCode = `<html><head><title>HMR Test</title><script src="/src/main.ts"></script></head><body><h1>Hello</h1></body></html>`;
    const htmlPath = join(root, "index.html");
    await ctx.setupFile("index.html", htmlCode);

    // Initial discovery
    await compiler.discover();
    await compiler.transform(htmlCode, htmlPath);
    await compiler.flush();
    compiler.io.writingFiles.clear();

    // 2. Mock Vite server and handleHotUpdate
    const wsSend = vi.fn();
    const mockServer = {
      config: { root },
      moduleGraph: {
        idToModuleMap: new Map(),
        getModuleById: vi.fn(),
        invalidateModule: vi.fn(),
      },
      ws: { send: wsSend },
    };

    // Trigger HMR for the HTML source file itself
    if (plugin.handleHotUpdate) {
      await plugin.handleHotUpdate({
        file: htmlPath,
        timestamp: Date.now(),
        modules: [],
        read: () => htmlCode.replace("Hello", "World"),
        server: mockServer as any,
      });
    }

    // 3. Verify that full-reload was sent
    expect(wsSend).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  });
});
