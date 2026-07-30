import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";

describe("ZintlCompiler - HTML catalogFormat DX", () => {
  const root = "/project";

  it("should respect catalogFormat for HTML when it is boundary-specific", () => {
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[locale]/[dir]/[name].json",
      },
      root,
      true,
    );

    // HTML file
    expect(compiler.getCatalogPath("src/index.html", "ar")).toBe(
      join(root, "locales", "ar/src/index.html.json"),
    );
  });

  it("should escape HTML from compound catalogFormat ([locale].json) using [path]", () => {
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[locale].json",
      },
      root,
      true,
    );

    // JS file goes to ar.json
    expect(compiler.getCatalogPath("src/main.ts", "ar")).toBe(join(root, "locales", "ar.json"));

    // HTML file should branch off using [path] to avoid collisions
    expect(compiler.getCatalogPath("src/index.html", "ar")).toBe(
      join(root, "locales", "src/index.html.ar.json"),
    );
  });

  it("should avoid collisions between HTML files with same name in different dirs when using [locale].json", () => {
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[locale].json",
      },
      root,
      true,
    );

    expect(compiler.getCatalogPath("src/pages/index.html", "ar")).toBe(
      join(root, "locales", "src/pages/index.html.ar.json"),
    );
    expect(compiler.getCatalogPath("src/components/index.html", "ar")).toBe(
      join(root, "locales", "src/components/index.html.ar.json"),
    );
  });

  it("should respect directory structure in compound format ([locale]/all.json)", () => {
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[locale]/all.json",
      },
      root,
      true,
    );

    expect(compiler.getCatalogPath("src/index.html", "ar")).toBe(
      join(root, "locales", "ar/src/index.html.all.json"),
    );
  });

  it("should support multilingual HTML catalogs when [locale] is omitted", () => {
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[dir]/[name].json",
      },
      root,
      true,
    );

    // Both ar and es should return the same path
    const pathAr = compiler.getCatalogPath("src/index.html", "ar");
    const pathEs = compiler.getCatalogPath("src/index.html", "es");

    expect(pathAr).toBe(join(root, "locales", "src/index.html.json"));
    expect(pathEs).toBe(join(root, "locales", "src/index.html.json"));
    expect(compiler.isMultilingualFormat()).toBe(true);
  });

  it("should support function-based catalogFormat for HTML", () => {
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: (ctx) => `html-stuff/${ctx.locale}/${ctx.path}.json`,
      },
      root,
      true,
    );

    expect(compiler.getCatalogPath("src/index.html", "ar")).toBe(
      join(root, "locales", "html-stuff/ar/src/index.html.json"),
    );
  });

  describe("Integration - Physical Catalog Generation", () => {
    const testRoot = join(process.cwd(), ".tmp/html-fmt-test");

    beforeEach(() => {
      if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
      mkdirSync(testRoot, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    });

    it("should generate single-locale HTML catalogs correctly", async () => {
      const compiler = createTestCompiler(
        {
          outputDir: "locales",
          catalogFormat: "[locale]/[dir]/[name].json",
          locales: ["en", "ar"],
        },
        testRoot,
        true,
      );

      // Mock some HTML metadata
      (compiler as any).messages.metadataGraph["index.html"] = {
        anchorSites: [
          { boundaryId: "index.html", locale: { type: "literal", value: "ar" }, isTopLevel: true },
        ],
        hasZintlMarker: false,
        htmlProjection: {
          title: "My App",
          dir: "ltr",
          scripts: [],
        },
      };

      await compiler.flush();

      const arPath = join(testRoot, "locales/ar/index.html.json");
      expect(existsSync(arPath)).toBe(true);

      const content = JSON.parse(readFileSync(arPath, "utf-8"));
      expect(content.title).toBe("");
      expect(content.dir).toBe("");
      expect(content.$schema).toBe("../.schemas/index.html.schema.json");
    });

    it("should generate multilingual HTML catalogs correctly", async () => {
      const compiler = createTestCompiler(
        {
          outputDir: "locales",
          catalogFormat: "[dir]/[name].json",
          locales: ["en", "ar", "es"],
        },
        testRoot,
        true,
      );

      (compiler as any).messages.metadataGraph["index.html"] = {
        anchorSites: [
          { boundaryId: "index.html", locale: { type: "expression" }, isTopLevel: true },
        ],
        hasZintlMarker: false,
        htmlProjection: {
          title: "My App",
          dir: "ltr",
          scripts: [],
        },
      };

      await compiler.flush();

      const path = join(testRoot, "locales/index.html.json");
      expect(existsSync(path)).toBe(true);

      const content = JSON.parse(readFileSync(path, "utf-8"));
      expect(content.title).toEqual({ ar: "", es: "" });
      expect(content.dir).toEqual({ ar: "", es: "" });
      expect(content.$schema).toBe(".schemas/index.html.schema.json");
    });
  });
});
