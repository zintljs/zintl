import { describe, it, expect, vi } from "vite-plus/test";
import { zintl } from "../index.ts";
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
