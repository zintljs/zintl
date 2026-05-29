// oxlint-disable no-unused-vars
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
import { join } from "node:path";

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
    readFileSync: (path: string, options?: any) => {
      if (mockReadFileSync !== null) return mockReadFileSync(path, options);
      return actual.readFileSync(path, options);
    },
  };
});

describe("HTML Fanning & Asset Multiplexing hooks", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;
  let mockThis: any;

  beforeEach(async () => {
    ctx = await createZintlContext({
      locales: ["en", "ar", "es"],
      sourceLocale: "en",
      multiplex: true,
      logLevel: "silent",
      isDev: true,
    });

    mockThis = {
      resolve: vi.fn().mockImplementation(async (id: string) => {
        return id;
      }),
      addWatchFile: vi.fn(),
    };
  });

  afterEach(async () => {
    mockExistsSync = null;
    mockReadFileSync = null;
    await ctx.cleanup();
  });

  describe("injectMultiplexQuery helper through resolveId", () => {
    beforeEach(() => {
      // Ensure the resolved target is not considered translation neutral,
      // so multiplex propagation is triggered
      const compiler = (ctx.plugin as any).__compiler;
      const normalizedId = compiler.getNormalizedId("src/util.ts");
      compiler.messages.metadataGraph = {
        [normalizedId]: {
          hasZintlMarker: true,
        },
      };
    });

    it("should append multiplex query to clean ID", async () => {
      const importer = "/mock/root/src/App.ts?zintl-multiplex=ar";
      const resolved = await ctx.plugin.resolveId.call(mockThis, "src/util.ts", importer);
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe("src/util.ts?zintl-multiplex=ar");
    });

    it("should append query correctly when other queries are present without script extension at the end", async () => {
      const importer = "/mock/root/src/App.ts?zintl-multiplex=ar";
      const resolved = await ctx.plugin.resolveId.call(mockThis, "src/util.ts?foo=bar", importer);
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe("src/util.ts?foo=bar&zintl-multiplex=ar");
    });

    it("should append query correctly when other queries are present with script extension at the end", async () => {
      const importer = "/mock/root/src/App.ts?zintl-multiplex=ar";
      const resolved = await ctx.plugin.resolveId.call(
        mockThis,
        "src/util.ts?foo=bar&sub.ts",
        importer,
      );
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe("src/util.ts?foo=bar&zintl-multiplex=ar&sub.ts");
    });
  });

  describe("resolveId edge cases", () => {
    it("should handle relative imports from .zintl- files", async () => {
      const importer = "/mock/root/src/Component.zintl-ar.vue";
      const resolved = await ctx.plugin.resolveId.call(mockThis, "./Child.vue", importer);
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe("/mock/root/src/Child.vue");
    });

    it("should resolve fanned HTML files to rootDir under locale folder", async () => {
      const resolved = await ctx.plugin.resolveId.call(mockThis, "ar/index.html", undefined);
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe(join(ctx.root, "ar/index.html"));
    });

    it("should propagate multiplexing to non-SFC dependencies unless translation neutral", async () => {
      const compiler = (ctx.plugin as any).__compiler;
      const normalizedChild = compiler.getNormalizedId("/mock/root/src/child.ts");
      compiler.messages.metadataGraph = {
        [normalizedChild]: {
          hasZintlMarker: true,
        },
      };

      const importer = "/mock/root/src/main.ts?zintl-multiplex=ar";
      const resolved = await ctx.plugin.resolveId.call(
        mockThis,
        "/mock/root/src/child.ts",
        importer,
      );
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe("/mock/root/src/child.ts?zintl-multiplex=ar");
    });

    it("should NOT propagate multiplexing if the dependency is translation neutral", async () => {
      const compiler = (ctx.plugin as any).__compiler;
      const normalizedChild = compiler.getNormalizedId("/mock/root/src/child.ts");
      compiler.messages.metadataGraph = {
        [normalizedChild]: {
          hasZintlMarker: false,
        },
      };

      const importer = "/mock/root/src/main.ts?zintl-multiplex=ar";
      const resolved = await ctx.plugin.resolveId.call(
        mockThis,
        "/mock/root/src/child.ts",
        importer,
      );
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe("/mock/root/src/child.ts");
    });

    it("should append zintl-multiplex query if resolved dependency did not include it (as string)", async () => {
      const compiler = (ctx.plugin as any).__compiler;
      const normalizedChild = compiler.getNormalizedId("/mock/root/src/child.ts");
      compiler.messages.metadataGraph = {
        [normalizedChild]: {
          hasZintlMarker: true,
        },
      };

      mockThis.resolve = vi.fn().mockResolvedValue("/mock/root/src/child.ts");

      const importer = "/mock/root/src/main.ts?zintl-multiplex=ar";
      const resolved = await ctx.plugin.resolveId.call(
        mockThis,
        "/mock/root/src/child.ts",
        importer,
      );
      expect(resolved).toBe("/mock/root/src/child.ts?zintl-multiplex=ar");
    });

    it("should append zintl-multiplex query if resolved dependency did not include it (as object)", async () => {
      const compiler = (ctx.plugin as any).__compiler;
      const normalizedChild = compiler.getNormalizedId("/mock/root/src/child.ts");
      compiler.messages.metadataGraph = {
        [normalizedChild]: {
          hasZintlMarker: true,
        },
      };

      mockThis.resolve = vi.fn().mockResolvedValue({ id: "/mock/root/src/child.ts" });

      const importer = "/mock/root/src/main.ts?zintl-multiplex=ar";
      const resolved = await ctx.plugin.resolveId.call(
        mockThis,
        "/mock/root/src/child.ts",
        importer,
      );
      expect(resolved).toEqual({ id: "/mock/root/src/child.ts?zintl-multiplex=ar" });
    });
  });

  describe("HTML Fanning in loadHook", () => {
    it("should fan index.html and inject lang and dir when no attributes exist", async () => {
      const htmlFile = join(ctx.root, "ar/index.html");
      mockExistsSync = (path: string) => {
        if (path === join(ctx.root, "index.html")) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === join(ctx.root, "index.html")) {
          return `<html><head><script type="module" src="/src/main.ts"></script></head><body></body></html>`;
        }
        return "";
      };

      const result = await ctx.plugin.load.call(mockThis, htmlFile);
      expect(result).toContain('<html lang="ar" dir="rtl">');
      expect(result).toContain('src="/src/main.ts?zintl-multiplex=ar"');
    });

    it("should replace existing lang and dir in fanned index.html", async () => {
      const htmlFile = join(ctx.root, "ar/index.html");
      mockExistsSync = (path: string) => {
        if (path === join(ctx.root, "index.html")) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === join(ctx.root, "index.html")) {
          return `<html lang="en" dir="ltr"><head><script type="module" src="/src/main.ts"></script></head><body></body></html>`;
        }
        return "";
      };

      const result = await ctx.plugin.load.call(mockThis, htmlFile);
      expect(result).toContain('<html lang="ar" dir="rtl">');
      expect(result).not.toContain('lang="en"');
      expect(result).not.toContain('dir="ltr"');
    });

    it("should respect dir set in the HTML catalog (single-locale format)", async () => {
      const htmlFile = join(ctx.root, "ar/index.html");
      mockExistsSync = (path: string) => {
        if (path === join(ctx.root, "index.html")) return true;
        if (path.endsWith("index.html.ar.json")) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === join(ctx.root, "index.html")) {
          return `<html><body></body></html>`;
        }
        if (path.endsWith("index.html.ar.json")) {
          return JSON.stringify({ dir: "ltr" });
        }
        return "";
      };

      const result = await ctx.plugin.load.call(mockThis, htmlFile);
      expect(result).toContain('<html lang="ar" dir="ltr">');
    });

    it("should respect dir set in the HTML catalog (multilingual format)", async () => {
      const htmlFile = join(ctx.root, "ar/index.html");
      const compiler = (ctx.plugin as any).__compiler;
      const origIsMulti = compiler.isMultilingualFormat;
      compiler.isMultilingualFormat = () => true;

      mockExistsSync = (path: string) => {
        if (path === join(ctx.root, "index.html")) return true;
        if (path.endsWith("index.html.ar.json")) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === join(ctx.root, "index.html")) {
          return `<html><body></body></html>`;
        }
        if (path.endsWith("index.html.ar.json")) {
          return JSON.stringify({ dir: { ar: "ltr" } });
        }
        return "";
      };

      try {
        const result = await ctx.plugin.load.call(mockThis, htmlFile);
        expect(result).toContain('<html lang="ar" dir="ltr">');
      } finally {
        compiler.isMultilingualFormat = origIsMulti;
      }
    });

    it("should handle invalid HTML catalog JSON gracefully", async () => {
      const htmlFile = join(ctx.root, "ar/index.html");
      mockExistsSync = (path: string) => {
        if (path === join(ctx.root, "index.html")) return true;
        if (path.endsWith("index.html.ar.json")) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === join(ctx.root, "index.html")) {
          return `<html><body></body></html>`;
        }
        if (path.endsWith("index.html.ar.json")) {
          return "{ invalid json }";
        }
        return "";
      };

      const result = await ctx.plugin.load.call(mockThis, htmlFile);
      expect(result).toContain('<html lang="ar" dir="rtl">');
    });

    it("should ignore node_modules or http module scripts", async () => {
      const htmlFile = join(ctx.root, "ar/index.html");
      mockExistsSync = (path: string) => {
        if (path === join(ctx.root, "index.html")) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === join(ctx.root, "index.html")) {
          return `<html><head>
            <script type="module" src="http://example.com/cdn.js"></script>
            <script type="module" src="//cdn.example.com/cdn.js"></script>
            <script type="module" src="/node_modules/dep.js"></script>
          </head><body></body></html>`;
        }
        return "";
      };

      const result = await ctx.plugin.load.call(mockThis, htmlFile);
      expect(result).toContain('src="http://example.com/cdn.js"');
      expect(result).toContain('src="//cdn.example.com/cdn.js"');
      expect(result).toContain('src="/node_modules/dep.js"');
    });

    it("should strip main script tags for non-fanned HTML in dev/serve mode", async () => {
      const htmlFile = join(ctx.root, "index.html");
      mockExistsSync = (path: string) => {
        if (path === htmlFile) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === htmlFile) {
          return `<html><head>
            <script type="module" src="/src/main.ts"></script>
            <script type="module" src="/main.ts"></script>
          </head><body></body></html>`;
        }
        return "";
      };

      const result = await ctx.plugin.load.call(mockThis, htmlFile);
      expect(result).not.toContain('src="/src/main.ts"');
      expect(result).not.toContain('src="/main.ts"');
    });
  });

  describe("SFC loads original component", () => {
    it("should load the original component and add watch file", async () => {
      const sfcFile = "/mock/root/src/Component.zintl-ar.vue";
      const originalPath = "/mock/root/src/Component.vue";

      mockExistsSync = (path: string) => {
        if (path === originalPath) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === originalPath) return "<template>Hello</template>";
        return "";
      };

      const loaded = await ctx.plugin.load.call(mockThis, sfcFile);
      expect(loaded).toBe("<template>Hello</template>");
      expect(mockThis.addWatchFile).toHaveBeenCalledWith(originalPath);
    });
  });

  describe("Asset Multiplexing in resolveId and load", () => {
    it("should resolve multiplexed assets to localized asset paths if present", async () => {
      const assetFile = "/mock/root/src/about.txt";
      const compiler = (ctx.plugin as any).__compiler;
      const assetId = compiler.getNormalizedId(assetFile);
      const localizedAssetFile = compiler.assets.getAssetPath(assetId, "ar");

      mockExistsSync = (path: string) => {
        if (path === localizedAssetFile) return true;
        return false;
      };

      const resolved = await ctx.plugin.resolveId.call(
        mockThis,
        `${assetFile}?zintl-multiplex=ar`,
        undefined,
      );
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe(localizedAssetFile);
    });

    it("should resolve multiplexed assets to source path if localized path is missing", async () => {
      const assetFile = "/mock/root/src/about.txt";
      mockExistsSync = (path: string) => false;

      const resolved = await ctx.plugin.resolveId.call(
        mockThis,
        `${assetFile}?zintl-multiplex=ar`,
        undefined,
      );
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      expect(resolvedId).toBe(assetFile);
    });

    it("should return translation-only for ?zintl-raw asset query", async () => {
      const assetFile = "/mock/root/src/about.txt";
      mockExistsSync = (path: string) => {
        if (path === assetFile) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === assetFile) return "Hello translate-me!";
        return "";
      };

      const loadedDev = await ctx.plugin.load.call(mockThis, `${assetFile}?zintl-raw`);
      expect(loadedDev).toContain("export default");
      expect(loadedDev).toContain("import.meta.hot");

      // Set isDev = false to test non-dev path
      const compiler = (ctx.plugin as any).__compiler;
      compiler.isDev = false;
      try {
        const loadedProd = await ctx.plugin.load.call(mockThis, `${assetFile}?zintl-raw`);
        expect(loadedProd).toContain("export default");
        expect(loadedProd).not.toContain("import.meta.hot");
      } finally {
        compiler.isDev = true;
      }
    });

    it("should load localized asset content with ?raw and multiplex query", async () => {
      const assetFile = "/mock/root/src/about.txt";
      const compiler = (ctx.plugin as any).__compiler;
      const assetId = compiler.getNormalizedId(assetFile);
      const localizedAssetFile = compiler.assets.getAssetPath(assetId, "ar");

      mockExistsSync = (path: string) => {
        if (path === assetFile || path === localizedAssetFile) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === assetFile) return "Hello World!";
        if (path === localizedAssetFile) return "مرحباً بالعالم!";
        return "";
      };

      const loaded = await ctx.plugin.load.call(mockThis, `${assetFile}?raw&zintl-multiplex=ar`);
      expect(loaded).toContain('export default "مرحباً بالعالم!";');
    });

    it("should generate dynamic proxy code for ?raw without multiplex query", async () => {
      const assetFile = "/mock/root/src/about.txt";
      mockExistsSync = (path: string) => {
        if (path === assetFile) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === assetFile) return "Hello Proxy!";
        return "";
      };

      const loaded = await ctx.plugin.load.call(mockThis, `${assetFile}?raw`);
      expect(loaded).toContain("new Proxy");
      expect(loaded).toContain("getLocale");
      expect(loaded).toContain("_t");
      expect(mockThis.addWatchFile).toHaveBeenCalled();
    });

    it("should return translationOnly if neither ?raw nor ?zintl-raw query parameters are present", async () => {
      const assetFile = "/mock/root/src/about.txt";
      mockExistsSync = (path: string) => {
        if (path === assetFile) return true;
        return false;
      };
      mockReadFileSync = (path: string, options: any) => {
        if (path === assetFile) return "Hello plain content!";
        return "";
      };

      const loaded = await ctx.plugin.load.call(mockThis, assetFile);
      expect(loaded).toBe("Hello plain content!");
    });
  });
});
