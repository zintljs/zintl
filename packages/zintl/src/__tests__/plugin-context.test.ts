import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import Context from "../context.js";
import { resolveOptions } from "../options.js";
import { configResolvedHook } from "../hooks/config.js";
import { ensureCompiler } from "../host.js";
import { registerUpdateApplier } from "../hmr/index.js";

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
    const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
    expect(ctx.options.locales).toEqual(["en", "ar"]);
    expect(ctx.server).toBeNull();
    expect(ctx.multiplexEnabled).toBeNull();
  });

  describe("getMultiplexLocale", () => {
    it("should return undefined when no zintl-multiplex param", () => {
      const ctx = new Context(resolveOptions({}));
      expect(ctx.getMultiplexLocale("/src/main.ts")).toBeUndefined();
    });

    it("should extract locale from zintl-multiplex query param", () => {
      const ctx = new Context(resolveOptions({}));
      expect(ctx.getMultiplexLocale("/src/main.ts?zintl-multiplex=ar")).toBe("ar");
      expect(ctx.getMultiplexLocale("/src/main.ts?v=123&zintl-multiplex=en")).toBe("en");
    });
  });

  describe("getMultiplex", () => {
    it("should return cached value when compiler and multiplexEnabled are set", () => {
      const ctx = new Context(resolveOptions({}));
      ctx.compiler = {} as any;
      ctx.multiplexEnabled = true;
      expect(ctx.getMultiplex()).toBe(true);

      ctx.multiplexEnabled = false;
      expect(ctx.getMultiplex()).toBe(false);
    });

    it("should use explicit options.multiplex when set", () => {
      const ctx = new Context(resolveOptions({ multiplex: true }));
      expect(ctx.getMultiplex({ root: "/mock" })).toBe(true);
    });

    it("should cache multiplex value on compiler when compiler is set", () => {
      const ctx = new Context(resolveOptions({ multiplex: false }));
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
          return `import { zintl } from 'zintljs'; zintl('*')`;
        }
        return "";
      };

      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
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
          return `import { zintl } from 'zintljs'; zintl()`;
        }
        return "";
      };

      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
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
          return `import { zintl } from 'zintljs'; zintl('en')`;
        }
        return "";
      };

      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
      const result = ctx.getMultiplex({ root: "/mock" });
      expect(result).toBe(false);
    });

    it("should handle rollupOptions.input as string", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new Context(resolveOptions({ locales: ["en"] }));
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: "pages/about.html" } },
      });
      expect(result).toBe(true);
    });

    it("should handle rollupOptions.input as array", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new Context(resolveOptions({ locales: ["en"] }));
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: ["index.html", "about.html"] } },
      });
      expect(result).toBe(true);
    });

    it("should handle rollupOptions.input as object", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new Context(resolveOptions({ locales: ["en"] }));
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: { main: "index.html", about: "about.html" } } },
      });
      expect(result).toBe(true);
    });

    it("should clean locale-prefixed entry paths", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
      const result = ctx.getMultiplex({
        root: "/mock",
        build: { rollupOptions: { input: { en: "en/index.html", ar: "ar/index.html" } } },
      });
      expect(result).toBe(true);
    });

    it("should clean ./ locale-prefixed entry paths", () => {
      mockExistsSync = () => true;
      mockReadFileSync = () => `zintl()`;

      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
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

      const ctx = new Context(resolveOptions({ locales: ["en"] }));
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

      const ctx = new Context(resolveOptions({ locales: ["en"] }));
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

      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
      const hook = configResolvedHook(ctx);
      hook({
        root: "/mock-root",
        command: "build",
        plugins: [],
      } as any);

      expect(ctx.compiler._resolved.facets.some((f) => f.name === "vue-extraction")).toBe(true);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "vanilla-extraction")).toBe(true);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "html-extraction")).toBe(true);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "react-extraction")).toBe(false);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "svelte-extraction")).toBe(false);
    });

    it("should detect frameworks from vite config resolved plugins", () => {
      mockExistsSync = () => false;

      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));
      const hook = configResolvedHook(ctx);
      hook({
        root: "/mock-root",
        command: "serve",
        plugins: [{ name: "vite:react-jsx" }, { name: "vite-plugin-svelte" }],
      } as any);

      expect(ctx.compiler._resolved.facets.some((f) => f.name === "react-extraction")).toBe(true);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "svelte-extraction")).toBe(true);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "vanilla-extraction")).toBe(true);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "html-extraction")).toBe(true);
      expect(ctx.compiler._resolved.facets.some((f) => f.name === "vue-extraction")).toBe(false);
    });
  });

  describe("ensureCompiler unsupported-host fence", () => {
    const view = (bundler: string) => ({
      root: "/mock-root",
      bundler,
      isDev: false,
      isSsr: false,
      pluginNames: [],
    });

    /**
     * Half-working is the failure mode this replaces.
     *
     * Virtual module resolution, the dynamic-import shape and HMR acceptance
     * all arrive from the bundler facet. With none active, each falls back to a
     * Vite-shaped default the host does not honour — so the build produces
     * output, and the output is wrong. Refusing is the kinder answer.
     */
    it.each(["webpack", "esbuild", "rollup"])("refuses to build on %s", (bundler) => {
      mockExistsSync = () => false;
      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));

      expect(() => ensureCompiler(ctx, view(bundler))).toThrow(
        new RegExp(`\\[Zintl\\] Unsupported build tool: "${bundler}"`),
      );
      // And it names the way out rather than only the problem.
      expect(() => ensureCompiler(ctx, view(bundler))).toThrow(/zintljs\/vite/);
      expect(() => ensureCompiler(ctx, view(bundler))).toThrow(/zintljs\/rsbuild/);
    });

    it("says so plainly when the host did not identify itself", () => {
      mockExistsSync = () => false;
      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));

      expect(() => ensureCompiler(ctx, view("unknown"))).toThrow(
        /This host did not identify itself/,
      );
    });

    it.each(["vite", "rspack"])("builds on %s, which has a bundler facet", (bundler) => {
      mockExistsSync = () => false;
      const ctx = new Context(resolveOptions({ locales: ["en", "ar"] }));

      expect(() => ensureCompiler(ctx, view(bundler))).not.toThrow();
    });

    /**
     * The fence asks the facet system, not an allowlist — so contributing a
     * bundler facet lifts it, which is the premise the architecture rests on.
     */
    it("lifts for a host that contributes its own bundler facet", () => {
      mockExistsSync = () => false;
      const ctx = new Context(
        resolveOptions({
          locales: ["en", "ar"],
          facets: ["builtins", { name: "farm", concern: "bundler", when: { bundler: "farm" } }],
        } as any),
      );

      expect(() => ensureCompiler(ctx, view("farm"))).not.toThrow();
    });
  });

  describe("ensureCompiler multiplex fence (L-022)", () => {
    it("throws when multiplex is requested on a bundler with no HTML fan-out", () => {
      mockExistsSync = () => false;
      const ctx = new Context(resolveOptions({ locales: ["en", "ar"], multiplex: true }));

      expect(() =>
        ensureCompiler(ctx, {
          root: "/mock-root",
          bundler: "rspack",
          isDev: false,
          isSsr: false,
          pluginNames: [],
        }),
      ).toThrow(/\[Zintl\] Multiplex is not supported/);
    });

    it("does not throw when multiplex is requested on Vite", () => {
      mockExistsSync = () => false;
      const ctx = new Context(resolveOptions({ locales: ["en", "ar"], multiplex: true }));

      expect(() =>
        ensureCompiler(ctx, {
          root: "/mock-root",
          bundler: "vite",
          isDev: false,
          isSsr: false,
          pluginNames: [],
        }),
      ).not.toThrow();
    });
  });

  /**
   * Proposal 029's two directions, and they are guarded differently on purpose.
   *
   * Registering an applier against a facet that declares no `hotUpdate` is a
   * mistake inside Zintl with a well-defined correct behaviour — no applier —
   * so it declines rather than throwing into someone's dev server. The other
   * direction, a facet claiming `hotUpdate` that no host honours, is the exact
   * state Rsbuild sat in before 029; nothing at runtime can tell "not registered
   * yet" from "never will be", so it is asserted here instead.
   */
  describe("hot-update applier fence (029)", () => {
    const applierStub = () => ({
      name: "stub",
      apply: () => ({ count: 0 }),
      applyChunkInvalidation: () => {},
      sendFullReload: () => {},
    });

    const ctxFor = (bundler: string, facets?: unknown[]) => {
      mockExistsSync = () => false;
      const ctx = new Context(
        resolveOptions({ locales: ["en", "ar"], ...(facets ? { facets } : {}) } as any),
      );
      ensureCompiler(ctx, {
        root: "/mock-root",
        bundler,
        isDev: true,
        isSsr: false,
        pluginNames: [],
      });
      return ctx;
    };

    /**
     * A real bundler facet that simply declares no `hotUpdate`.
     *
     * This case used to be reached by naming a bundler nobody serves, which the
     * unsupported-host fence now rejects before resolution — correctly, since a
     * host with no facet at all never gets as far as the applier question. The
     * scenario under test is the other one: a host Zintl *does* serve whose
     * facet does not claim hot updates, which is what every new bundler facet
     * looks like on its first day.
     */
    const bundlerFacetWithoutHotUpdate = {
      name: "test-bundler",
      concern: "bundler",
      when: { bundler: "test-bundler" },
    };

    it("declines an applier when the bundler facet declares no hotUpdate", () => {
      const ctx = ctxFor("test-bundler", ["builtins", bundlerFacetWithoutHotUpdate]);
      expect(ctx.compiler._resolved.flags.hotUpdate).toBe(false);
      expect(registerUpdateApplier(ctx, applierStub())).toBe(false);
      expect(ctx.updateApplier).toBeNull();
    });

    it.each(["vite", "rspack"])("accepts an applier on %s, which declares one", (bundler) => {
      const ctx = ctxFor(bundler);
      expect(ctx.compiler._resolved.flags.hotUpdate).toBe(true);
      expect(registerUpdateApplier(ctx, applierStub())).toBe(true);
      expect(ctx.updateApplier).not.toBeNull();
    });
  });
});
