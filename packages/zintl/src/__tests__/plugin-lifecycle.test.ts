import { describe, it, expect, vi } from "vite-plus/test";
import zintl from "../vite.js";

let mockExistsSync: any = null;
let mockReadFileSync: any = null;

vi.mock("node:fs", async () => {
  const actual = (await vi.importActual("node:fs")) as any;
  return {
    ...actual,
    existsSync: (path: string) => {
      if (mockExistsSync !== null) return mockExistsSync(path);
      return actual.existsSync(path);
    },
    readFileSync: (path: string, options: any) => {
      if (mockReadFileSync !== null) return mockReadFileSync(path, options);
      return actual.readFileSync(path, options);
    },
  };
});
import {
  RESOLVED_VIRTUAL_PREFIX,
  RESOLVED_CHUNK_PREFIX,
  RESOLVED_CONTENT_PREFIX,
  RESOLVED_MANAGER_PREFIX,
} from "../constants.ts";

describe("Zintl Vite Plugin Lifecycle", () => {
  it("should handle options.debug in config", () => {
    const pluginTrue = zintl({ debug: true });
    const configResultTrue = (pluginTrue as any).config({});
    expect(configResultTrue.define["process.env.ZINTL_DEBUG"]).toBe('"true"');

    const pluginTrace = zintl({ debug: "trace" });
    const configResultTrace = (pluginTrace as any).config({});
    expect(configResultTrace.define["process.env.ZINTL_DEBUG"]).toBe('"trace"');
  });

  it("should execute buildStart logic (discovery) when no server", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "build" });

    const compiler = (plugin as any).__compiler;
    const discoverSpy = vi.spyOn(compiler, "discover").mockResolvedValue(undefined);
    const setupSpy = vi.spyOn(compiler, "setup").mockResolvedValue(undefined);

    await (plugin as any).buildStart();
    expect(setupSpy).toHaveBeenCalled();
    expect(discoverSpy).toHaveBeenCalled();
  });

  it("should not execute discover in buildStart when server is present", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "serve" });
    (plugin as any).configureServer({ middlewares: { use: vi.fn() } }); // Sets server

    const compiler = (plugin as any).__compiler;
    const discoverSpy = vi.spyOn(compiler, "discover").mockResolvedValue(undefined);
    const setupSpy = vi.spyOn(compiler, "setup").mockResolvedValue(undefined);

    await (plugin as any).buildStart();
    expect(setupSpy).toHaveBeenCalled();
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it("should handle load for legacy RESOLVED_VIRTUAL_PREFIX", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "build" });
    const compiler = (plugin as any).__compiler;
    vi.spyOn(compiler, "generateVirtualModule").mockResolvedValue({
      code: "export default {};",
      watchedFiles: ["/mock/file.ts"],
    });

    const context = {
      addWatchFile: vi.fn(),
    };

    const result = await (plugin as any).load.call(context, `${RESOLVED_VIRTUAL_PREFIX}:b_123`);
    expect(result).toBe("export default {};");
    expect(context.addWatchFile).toHaveBeenCalledWith("/mock/file.ts");
    expect(compiler.generateVirtualModule).toHaveBeenCalledWith("b_123");
  });

  it("should handle load for RESOLVED_MANAGER_PREFIX", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "build" });
    const compiler = (plugin as any).__compiler;
    vi.spyOn(compiler, "generateVirtualModule").mockResolvedValue({
      code: "export const manager = {};",
      watchedFiles: ["/mock/manager.ts"],
    });

    const context = {
      addWatchFile: vi.fn(),
    };

    // virtual:zintl/manager/none/entry:b_123
    const result = await (plugin as any).load.call(
      context,
      `${RESOLVED_MANAGER_PREFIX}/none/entry:b_123`,
    );
    expect(result).toBe("export const manager = {};");
    expect(context.addWatchFile).toHaveBeenCalledWith("/mock/manager.ts");
    expect(compiler.generateVirtualModule).toHaveBeenCalledWith("entry:b_123", undefined, true);

    await (plugin as any).load.call(context, `${RESOLVED_MANAGER_PREFIX}/en/entry:b_123`);
    expect(compiler.generateVirtualModule).toHaveBeenCalledWith("entry:b_123", "en", true);
  });

  it("should handle load for RESOLVED_CHUNK_PREFIX", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "build" });
    const compiler = (plugin as any).__compiler;
    vi.spyOn(compiler, "generateVirtualModule").mockResolvedValue({
      code: "export const chunk = {};",
      watchedFiles: ["/mock/chunk.ts"],
    });

    const context = {
      addWatchFile: vi.fn(),
    };

    const result = await (plugin as any).load.call(context, `${RESOLVED_CHUNK_PREFIX}/entry:b_123`);
    expect(result).toBe("export const chunk = {};");
    expect(context.addWatchFile).toHaveBeenCalledWith("/mock/chunk.ts");
    expect(compiler.generateVirtualModule).toHaveBeenCalledWith("entry:b_123");
  });

  it("should handle load for RESOLVED_CONTENT_PREFIX", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "build" });
    const compiler = (plugin as any).__compiler;
    vi.spyOn(compiler, "generateVirtualModule").mockResolvedValue({
      code: "export default { 'hello': 'world' };",
      watchedFiles: ["/mock/content.ts"],
    });

    const context = {
      addWatchFile: vi.fn(),
    };

    const result = await (plugin as any).load.call(
      context,
      `${RESOLVED_CONTENT_PREFIX}/en/entry:b_123`,
    );
    expect(result).toBe("export default { 'hello': 'world' };");
    expect(context.addWatchFile).toHaveBeenCalledWith("/mock/content.ts");
    expect(compiler.generateVirtualModule).toHaveBeenCalledWith("entry:b_123", "en");
  });

  it("should handle load for RESOLVED_CONTENT_PREFIX with query parameters", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "build" });
    const compiler = (plugin as any).__compiler;
    vi.spyOn(compiler, "generateVirtualModule").mockResolvedValue({
      code: "export default { 'cache': 'busted' };",
      watchedFiles: ["/mock/content.ts"],
    });

    const context = {
      addWatchFile: vi.fn(),
    };

    const result = await (plugin as any).load.call(
      context,
      `${RESOLVED_CONTENT_PREFIX}/en/entry:b_123?t=123456`,
    );
    expect(result).toBe("export default { 'cache': 'busted' };");
    expect(context.addWatchFile).toHaveBeenCalledWith("/mock/content.ts");
    // Ensure that query parameters like ?t=123456 do NOT bleed into the chunk ID
    expect(compiler.generateVirtualModule).toHaveBeenCalledWith("entry:b_123", "en");
  });

  it("should call compiler.flush on buildEnd", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "build" });
    const compiler = (plugin as any).__compiler;
    const flushSpy = vi.spyOn(compiler, "flush").mockResolvedValue(undefined);

    await (plugin as any).buildEnd();
    expect(flushSpy).toHaveBeenCalled();
  });
});

describe("Zintl Vite Plugin HMR", () => {
  it("should invalidate affected chunks in transform when server is present", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "serve" });

    const invalidateModuleSpy = vi.fn();
    const server = {
      config: { root: "/mock" },
      moduleGraph: {
        idToModuleMap: new Map([
          ["\0virtual:zintl/catalog/entry:b_test", { id: "mod1" }],
          ["\0virtual:zintl/catalog/other:b_test", { id: "mod2" }],
        ]),
        invalidateModule: invalidateModuleSpy,
      },
      middlewares: { use: vi.fn() },
    };
    (plugin as any).configureServer(server);

    const compiler = (plugin as any).__compiler;
    vi.spyOn(compiler, "transform").mockResolvedValue({ code: "changed" } as any);
    vi.spyOn(compiler, "getAffectedChunks").mockReturnValue(["entry:b_test"]);

    await (plugin as any).transform("const a = 1;", "/mock/src/file.ts");

    expect(compiler.getAffectedChunks).toHaveBeenCalledWith("src/file");
    expect(invalidateModuleSpy).toHaveBeenCalledWith({ id: "mod1" });
    expect(invalidateModuleSpy).not.toHaveBeenCalledWith({ id: "mod2" });
  });

  it("should return affected virtual modules from handleHotUpdate", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "serve" });
    const compiler = (plugin as any).__compiler;

    vi.spyOn(compiler, "isWritingFile").mockReturnValue(false);
    vi.spyOn(compiler, "invalidateFile").mockResolvedValue(["src/other"]);
    vi.spyOn(compiler, "flush").mockResolvedValue(undefined);
    vi.spyOn(compiler, "getAffectedChunks").mockImplementation(((boundaryId: string) => {
      if (boundaryId === "src/file") return ["entry:b_file"];
      if (boundaryId === "src/other") return ["shared:b_other"];
      return [];
    }) as any);

    const invalidateModuleSpy = vi.fn();
    const mod1 = { id: "mod1" };
    const mod2 = { id: "mod2" };
    const mod3 = { id: "mod3" };
    const server = {
      config: { root: "/mock" },
      moduleGraph: {
        idToModuleMap: new Map([
          ["\0virtual:zintl/catalog/entry:b_file", mod1],
          ["\0virtual:zintl/manager/en/shared:b_other", mod2],
        ]),
        getModuleById: vi.fn().mockImplementation((id: string) => {
          if (id === `${RESOLVED_VIRTUAL_PREFIX}:src/other`) return mod3;
          return null;
        }),
        invalidateModule: invalidateModuleSpy,
      },
      middlewares: { use: vi.fn() },
    };

    const context = {
      file: "/mock/src/file.ts",
      server,
      modules: [{ id: "source_mod" }],
    };

    const result = await (plugin as any).handleHotUpdate(context);

    expect(compiler.invalidateFile).toHaveBeenCalledWith("/mock/src/file.ts");
    expect(result).toContain(mod1);
    expect(result).toContain(mod2);
    expect(result).toContain(mod3);
    expect(result?.length).toBe(4);

    expect(invalidateModuleSpy).toHaveBeenCalledWith(mod1);
    expect(invalidateModuleSpy).toHaveBeenCalledWith(mod2);
    expect(invalidateModuleSpy).toHaveBeenCalledWith(mod3);
  });

  it("should ignore non-source and non-json files in handleHotUpdate", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "serve" });
    const compiler = (plugin as any).__compiler;

    vi.spyOn(compiler, "isWritingFile").mockReturnValue(false);
    const invalidateSpy = vi.spyOn(compiler, "invalidateFile");

    const result = await (plugin as any).handleHotUpdate({
      file: "/mock/src/style.css",
    });

    expect(result).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("should prevent HMR loops if isWritingFile is true", async () => {
    const plugin = zintl();
    (plugin as any).configResolved({ root: "/mock", command: "serve" });
    const compiler = (plugin as any).__compiler;

    vi.spyOn(compiler, "isWritingFile").mockReturnValue(true);
    const invalidateSpy = vi.spyOn(compiler, "invalidateFile");

    const result = await (plugin as any).handleHotUpdate({
      file: "/mock/src/file.ts",
    });

    expect(result).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("Zintl Vite Plugin Config & Context Edge Cases", () => {
  it("should handle configHook with Array and Object inputs and filter fanned inputs", () => {
    const plugin = zintl({ locales: ["en", "ar"], multiplex: true });
    const configFn = (plugin as any).config;

    // Test Array input
    const arrayConfig = configFn({
      build: {
        rollupOptions: {
          input: ["index.html", "about.html", "ar/index.html", "./ar/about.html"],
        },
      },
    });
    // Locales are "en" and "ar". Fanned inputs "ar/index.html" and "./ar/about.html" should be deleted.
    // The remaining input should be expanded for all locales.
    expect(arrayConfig.build.rollupOptions.input).toHaveProperty("index");
    expect(arrayConfig.build.rollupOptions.input).toHaveProperty("about");
    expect(arrayConfig.build.rollupOptions.input).toHaveProperty("en/index");
    expect(arrayConfig.build.rollupOptions.input).toHaveProperty("ar/index");
    expect(arrayConfig.build.rollupOptions.input).toHaveProperty("en/about");
    expect(arrayConfig.build.rollupOptions.input).toHaveProperty("ar/about");
    // Ensure the fanned ones are not there as raw entries
    expect(arrayConfig.build.rollupOptions.input).not.toHaveProperty("ar_index");

    // Test Object input
    const objectConfig = configFn({
      build: {
        rollupOptions: {
          input: {
            main: "index.html",
            fanned: "ar/about.html",
          },
        },
      },
    });
    expect(objectConfig.build.rollupOptions.input).toHaveProperty("en/index");
    expect(objectConfig.build.rollupOptions.input).not.toHaveProperty("fanned");

    // Test empty input fallback to index.html
    const emptyConfig = configFn({
      build: {
        rollupOptions: {
          input: ["ar/index.html"], // will be cleaned/deleted, leaving empty
        },
      },
    });
    expect(emptyConfig.build.rollupOptions.input).toHaveProperty("en/index");
  });

  it("should handle getMultiplex with Array, Object, and fanned input path slicing, and fallback scanning", async () => {
    const plugin = zintl({ locales: ["en", "ar"] });

    // 1. Test scanning finds zintl() in main.ts
    mockExistsSync = (path: string) => {
      if (path.endsWith("index.html")) return true;
      if (path.endsWith("main.ts")) return true;
      return false;
    };

    mockReadFileSync = (path: string) => {
      if (path.endsWith("index.html")) {
        return `<html><body><script src="./src/main.ts"></script></body></html>`;
      }
      if (path.endsWith("main.ts")) {
        return `import { zintl } from "zintl"; zintl();`;
      }
      return "";
    };

    try {
      const configFn = (plugin as any).config;
      const res = configFn({
        root: "/mock-root",
        build: {
          rollupOptions: {
            input: ["./ar/index.html"],
          },
        },
      });
      // Should have build.rollupOptions.input fanned because multiplex is detected as true
      expect(res.build?.rollupOptions?.input).toHaveProperty("en/index");
    } finally {
      mockExistsSync = null;
      mockReadFileSync = null;
    }

    // 2. Test getMultiplex catch block
    mockExistsSync = () => {
      throw new Error("Disk error");
    };

    try {
      const configFn = (plugin as any).config;
      const res = configFn({
        root: "/mock-root",
        build: {
          rollupOptions: {
            input: ["index.html"],
          },
        },
      });
      // Should NOT have build fanned because error was caught and multiplex is false
      expect(res.build).toBeUndefined();
    } finally {
      mockExistsSync = null;
    }
  });
});

describe("Zintl Vite Plugin transformIndexHtml Hook Edge Cases", () => {
  it("should return original HTML if multiplexed but not fanned", async () => {
    const plugin = zintl({ locales: ["en", "ar"], multiplex: true });
    (plugin as any).configResolved({ root: "/mock", command: "serve" });

    const handler = (plugin as any).transformIndexHtml.handler;
    const html = "<html></html>";
    const result = await handler(html, { filename: "/mock/index.html" });
    expect(result).toBe(html);
  });

  it("should transform HTML and scan bundle in production mode", async () => {
    const plugin = zintl({ locales: ["en", "ar"], multiplex: false });
    (plugin as any).configResolved({ root: "/mock", command: "build" });

    const compiler = (plugin as any).__compiler;
    vi.spyOn(compiler, "transformHtml").mockImplementation(
      async (html: any, _filename: any, preloads: any) => {
        return `preloads:${JSON.stringify(preloads)}:${html}`;
      },
    );

    const handler = (plugin as any).transformIndexHtml.handler;
    const html = "<html></html>";

    const viteCtx = {
      filename: "/mock/en/index.html",
      bundle: {
        "assets/main.js": {
          type: "chunk",
          moduleIds: ["\0virtual:zintl/content/en/entry:b1"],
        },
        "assets/ignored.js": {
          type: "asset",
          moduleIds: ["\0virtual:zintl/content/en/entry:b1"],
        },
        "assets/other.js": {
          type: "chunk",
          moduleIds: ["\0virtual:zintl/content/en/entry:b1"],
        },
      },
      server: {
        config: {
          base: "/",
        },
      },
    };

    const result = await handler(html, viteCtx);
    expect(result).toContain('preloads:{"en":["/assets/main.js","/assets/other.js"]}');
  });
});
