import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { ZintlPluginContext } from "../context.js";
import { configResolvedHook } from "../hooks/config.js";

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

describe("ZintlPluginContext", () => {
  afterEach(() => {
    mockExistsSync = null;
    mockReadFileSync = null;
  });

  it("should construct with options", () => {
    const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
    expect(ctx.options.locales).toEqual(["en", "ar"]);
    expect(ctx.server).toBeNull();
    expect(ctx.multiplexEnabled).toBeNull();
  });

  describe("getMultiplexLocale", () => {
    it("should return undefined when no zintl-multiplex param", () => {
      const ctx = new ZintlPluginContext({});
      expect(ctx.getMultiplexLocale("/src/main.ts")).toBeUndefined();
    });

    it("should extract locale from zintl-multiplex query param", () => {
      const ctx = new ZintlPluginContext({});
      expect(ctx.getMultiplexLocale("/src/main.ts?zintl-multiplex=ar")).toBe("ar");
      expect(ctx.getMultiplexLocale("/src/main.ts?v=123&zintl-multiplex=en")).toBe("en");
    });
  });

  describe("getMultiplex", () => {
    it("should return cached value when compiler and multiplexEnabled are set", () => {
      const ctx = new ZintlPluginContext({});
      ctx.compiler = {} as any;
      ctx.multiplexEnabled = true;
      expect(ctx.getMultiplex()).toBe(true);

      ctx.multiplexEnabled = false;
      expect(ctx.getMultiplex()).toBe(false);
    });

    it("should use explicit options.multiplex when set", () => {
      const ctx = new ZintlPluginContext({ multiplex: true } as any);
      expect(ctx.getMultiplex({ root: "/mock" })).toBe(true);
    });

    it("should cache multiplex value on compiler when compiler is set", () => {
      const ctx = new ZintlPluginContext({ multiplex: false } as any);
      ctx.compiler = {} as any;
      ctx.getMultiplex();
      expect(ctx.multiplexEnabled).toBe(false);
    });

    it("should detect zintl('*') in entry files", () => {
      mockExistsSync = () => true;
      mockReadFileSync = (path: string) => {
        if (path.endsWith("index.html")) {
          return `<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>`;
        }
        if (path.endsWith("main.ts")) {
          return `import { zintl } from 'zintl'; zintl('*')`;
        }
        return "";
      };

      const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
      const result = ctx.getMultiplex({ root: "/mock" });
      expect(result).toBe(true);
    });

    it("should detect zintl() (no args) in entry files", () => {
      mockExistsSync = () => true;
      mockReadFileSync = (path: string) => {
        if (path.endsWith("index.html")) {
          return `<html><body><script type="module" src="/src/main.ts"></script></body></html>`;
        }
        if (path.endsWith("main.ts")) {
          return `import { zintl } from 'zintl'; zintl()`;
        }
        return "";
      };

      const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
      const result = ctx.getMultiplex({ root: "/mock" });
      expect(result).toBe(true);
    });

    it("should return false when no zintl() or zintl('*') detected", () => {
      mockExistsSync = () => true;
      mockReadFileSync = (path: string) => {
        if (path.endsWith("index.html")) {
          return `<html><body><script type="module" src="/src/main.ts"></script></body></html>`;
        }
        if (path.endsWith("main.ts")) {
          return `import { zintl } from 'zintl'; zintl('en')`;
        }
        return "";
      };

      const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
      const result = ctx.getMultiplex({ root: "/mock" });
      expect(result).toBe(false);
    });

    it("should handle rollupOptions.input as string", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new ZintlPluginContext({ locales: ["en"] });
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: "pages/about.html" } },
      });
      expect(result).toBe(true);
    });

    it("should handle rollupOptions.input as array", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new ZintlPluginContext({ locales: ["en"] });
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: ["index.html", "about.html"] } },
      });
      expect(result).toBe(true);
    });

    it("should handle rollupOptions.input as object", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new ZintlPluginContext({ locales: ["en"] });
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: { main: "index.html", about: "about.html" } } },
      });
      expect(result).toBe(true);
    });

    it("should clean locale-prefixed entry paths", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: { en: "en/index.html", ar: "ar/index.html" } } },
      });
      expect(result).toBe(true);
    });

    it("should clean ./ locale-prefixed entry paths", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: "./en/index.html" } },
      });
      expect(result).toBe(true);
    });

    it("should return false on errors and cache false on compiler", () => {
      // Force an error by making existsSync throw
      mockExistsSync = () => {
        throw new Error("boom");
      };

      const ctx = new ZintlPluginContext({ locales: ["en"] });
      ctx.compiler = {} as any;
      const result = ctx.getMultiplex({ root: "/mock" });
      expect(result).toBe(false);
      expect(ctx.multiplexEnabled).toBe(false);
    });

    it("should not scan script src that starts with http or //", () => {
      mockExistsSync = () => true;
      mockReadFileSync = (path: string) => {
        if (path.endsWith("index.html")) {
          return `<html><body><script type="module" src="https://cdn.example.com/app.js"></script><script type="module" src="//cdn.example.com/app.js"></script></body></html>`;
        }
        // The test should NOT reach here for external scripts
        return "";
      };

      const ctx = new ZintlPluginContext({ locales: ["en"] });
      const result = ctx.getMultiplex({ root: "/mock" });
      expect(result).toBe(false);
    });
  });

  describe("configResolvedHook Target Resolution", () => {
    it("should detect vue from package.json dependencies", () => {
      mockExistsSync = (path: string) => path.endsWith("package.json");
      mockReadFileSync = (path: string) => {
        if (path.endsWith("package.json")) {
          return JSON.stringify({
            dependencies: { vue: "^3.0.0" },
          });
        }
        return "";
      };

      const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
      const hook = configResolvedHook(ctx);
      hook({
        root: "/mock-root",
        command: "build",
        plugins: [],
      } as any);

      expect(ctx.compiler._options.targets).toContain("vue");
      expect(ctx.compiler._options.targets).toContain("vanilla");
      expect(ctx.compiler._options.targets).toContain("html");
      expect(ctx.compiler._options.targets).not.toContain("react");
      expect(ctx.compiler._options.targets).not.toContain("svelte");
    });

    it("should detect frameworks from vitePlugins/plugins option", () => {
      mockExistsSync = () => false;

      const ctx = new ZintlPluginContext({ locales: ["en", "ar"] });
      const hook = configResolvedHook(ctx);
      hook({
        root: "/mock-root",
        command: "serve",
        plugins: [{ name: "vite:react-jsx" }, { name: "vite-plugin-svelte" }],
      } as any);

      expect(ctx.compiler._options.targets).toContain("react");
      expect(ctx.compiler._options.targets).toContain("svelte");
      expect(ctx.compiler._options.targets).toContain("vanilla");
      expect(ctx.compiler._options.targets).toContain("html");
      expect(ctx.compiler._options.targets).not.toContain("vue");
    });
  });
});
