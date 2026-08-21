import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * What the compiler's self-write guard does when its timer fires.
 *
 * Called after a flush in every test below, because that is the state a watcher
 * event actually arrives in: the write finished a while ago. It used to be the
 * whole of the guard, which is why these tests could hand the compiler its own
 * catalog and be answered as if a person had edited it.
 */
function writeGuardLapses(compiler: any) {
  compiler.io.writingFiles.clear();
}

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
    await ctx.setupFile("src/main.ts", `import { zintl } from "zintljs"; zintl("en");`);
    const htmlCode = `<html><head><title>HMR Test</title><script src="/src/main.ts"></script></head></html>`;
    await ctx.setupFile("index.html", htmlCode);

    // Initial discovery
    await compiler.discover();
    const htmlPath = join(root, "index.html");
    await compiler.transform(htmlCode, htmlPath);
    await compiler.flush();
    writeGuardLapses(compiler);

    const catalogPath = join(root, "locales", "index.html.ar.json");
    expect(await compiler.io.exists(catalogPath)).toBe(true);

    /**
     * A person editing the translation, which is what this test is about.
     *
     * It used to fire the update without touching the file — so what reached the
     * hook was the compiler's *own* write coming back, and the reload it
     * asserted was the compiler reloading the browser over a file it had decided
     * to write. That is the defect `syntax-recovery` intermittently stalls on,
     * recorded here as the expected behaviour.
     */
    await writeFile(catalogPath, JSON.stringify({ "HMR Test": "اختبار" }, null, 2), "utf-8");

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
    const tsCode = `import { zintl } from "zintljs"; zintl("en"); console.log("Hello");`;
    await ctx.setupFile("src/main.ts", tsCode);

    await compiler.discover();
    await compiler.flush();
    writeGuardLapses(compiler);

    const catalogPath = compiler.catalog.getCatalogPath("src/main", "ar");
    /**
     * A real edit, for the same reason as above: handing the hook the compiler's
     * own bytes would make this pass without reaching the boundary logic it is
     * checking. Created here rather than by the flush — this boundary has no
     * extractable strings, so no catalog was written for it, and firing an event
     * at a path that does not exist is not the thing being tested either.
     */
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, JSON.stringify({ Hello: "مرحبا" }, null, 2), "utf-8");

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

  it("does not reload for its own catalog write, however late the watcher reports it", async () => {
    /**
     * The regression `syntax-recovery` was stalling on, at the seam it happens.
     *
     * `writingFiles` is a 500 ms window, and ZDB Corollary D1a says a window is
     * never a guard. Under parallel load the echo of a catalog write arrives
     * after it closes; the hook then reads Zintl's own file as a user edit,
     * `index.html.<locale>.json` maps back to the `index.html` boundary, and a
     * `.html` boundary means a full page reload.
     *
     * Wasted work most of the time. In `syntax-recovery` the reload lands while
     * the app is deliberately broken, so the page comes back with its entry
     * failing to load — no Zintl runtime, no module registered for it — and the
     * recovery edit that follows arrives as a hot `update` nothing in the page
     * can accept.
     */
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    await ctx.setupFile("src/main.ts", `import { zintl } from "zintljs"; zintl("en");`);
    const htmlCode = `<html><head><title>HMR Test</title><script src="/src/main.ts"></script></head></html>`;
    await ctx.setupFile("index.html", htmlCode);

    await compiler.discover();
    await compiler.transform(htmlCode, join(root, "index.html"));
    await compiler.flush();
    writeGuardLapses(compiler);

    const catalogPath = join(root, "locales", "index.html.ar.json");
    expect(await compiler.io.exists(catalogPath)).toBe(true);

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

    // The file on disk is untouched since the flush wrote it — so this event is
    // the echo, whatever the clock says.
    await plugin.handleHotUpdate!({
      file: catalogPath,
      timestamp: Date.now(),
      modules: [],
      read: () => "",
      server: mockServer as any,
    });

    expect(wsSend).not.toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  });

  it("does not reload when the watcher reports a catalog nobody changed", async () => {
    /**
     * The event that strands `syntax-recovery`, at the seam it arrives.
     *
     * Not an echo of anything Zintl wrote in this process — a worker copy
     * settling, or an initial watcher scan draining, reported seconds into the
     * test. The compiler has only ever *read* this file, and its contents are
     * still what it read. Nothing has changed, so nothing may be delivered — and
     * above all the browser must not be reloaded, because a reload landing while
     * the app does not compile leaves a page with no runtime and no module
     * registered for the entry.
     */
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    await ctx.setupFile("src/main.ts", `import { zintl } from "zintljs"; zintl("en");`);
    const htmlCode = `<html><head><title>HMR Test</title><script src="/src/main.ts"></script></head></html>`;
    await ctx.setupFile("index.html", htmlCode);

    await compiler.discover();
    await compiler.transform(htmlCode, join(root, "index.html"));
    await compiler.flush();
    writeGuardLapses(compiler);

    const catalogPath = join(root, "locales", "index.html.ar.json");
    expect(await compiler.io.exists(catalogPath)).toBe(true);

    // Forget the write, then read: the state a compiler is in for a file that
    // was on disk before it started.
    compiler.io.forgetWrite(catalogPath);
    await compiler.io.readFile(catalogPath);

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

    await plugin.handleHotUpdate!({
      file: catalogPath,
      timestamp: Date.now(),
      modules: [],
      read: () => "",
      server: mockServer as any,
    });

    expect(wsSend).not.toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  });

  it("should trigger full-reload when the source HTML file is modified", async () => {
    const { root, plugin } = ctx;
    const compiler = (plugin as any).__compiler;

    // 1. Setup an HTML file and its script
    await ctx.setupFile("src/main.ts", `import { zintl } from "zintljs"; zintl("en");`);
    const htmlCode = `<html><head><title>HMR Test</title><script src="/src/main.ts"></script></head><body><h1>Hello</h1></body></html>`;
    const htmlPath = join(root, "index.html");
    await ctx.setupFile("index.html", htmlCode);

    // Initial discovery
    await compiler.discover();
    await compiler.transform(htmlCode, htmlPath);
    await compiler.flush();
    writeGuardLapses(compiler);

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
