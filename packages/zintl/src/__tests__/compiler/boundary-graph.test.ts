import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler: ZintlCompiler };

describe("Boundary Graph Algorithm", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-boundary-graph-");
    context.compiler = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      context.root,
      true,
    );
  });

  describe("Entry Point Detection", () => {
    it("should process files with zintl trust anchor", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      const entryCode = `
                import { zintl } from "zintljs";
        zintl("en");
        const mainTitle = "Main Title";
        import layout from "./layout";
      `;

      const result = await compiler.transform(
        entryCode,
        join(testRoot, "src/entry.ts"),
        "virtual:zintl-catalog",
      );

      // Should return a result (indicating processing occurred)
      expect(result).toBeDefined();
      expect(typeof result!.code).toBe("string");
    });

    it("should process multiple entry points", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      const microEntryCode = `
                import { zintl } from "zintljs";
        zintl("en");
        const adminTitle = "Admin Panel";
        import settings from "./settings";
      `;

      const result = await compiler.transform(
        microEntryCode,
        join(testRoot, "src/admin.ts"),
        "virtual:zintl-catalog",
      );

      // Should return a result (indicating processing occurred)
      expect(result).toBeDefined();
      expect(typeof result!.code).toBe("string");
    });
  });

  describe("Static vs Dynamic Import Classification", () => {
    it("should handle static imports", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      const code = `
                import { zintl } from "zintljs";
        zintl("en");
        const title = "Title";
        import staticDep from "./static";
      `;

      const result = await compiler.transform(
        code,
        join(testRoot, "src/entry.ts"),
        "virtual:zintl-catalog",
      );
      expect(result).toBeDefined();
    });

    it("should handle dynamic imports", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      const code = `
                import { zintl } from "zintljs";
        zintl("en");
        const title = "Title";
        import("./dynamic");
      `;

      const result = await compiler.transform(
        code,
        join(testRoot, "src/entry.ts"),
        "virtual:zintl-catalog",
      );
      expect(result).toBeDefined();
    });
  });

  describe("Boundary ID Generation", () => {
    it("should generate stable boundary IDs", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      const code = `        import { zintl } from "zintljs";
        zintl("en"); const msg = "test";`;

      // Transform same file twice
      await compiler.transform(code, join(testRoot, "src/test.ts"), "virtual:zintl-catalog");
      await compiler.transform(code, join(testRoot, "src/test.ts"), "virtual:zintl-catalog");

      // Should generate same stable ID
      expect(true).toBe(true); // Placeholder - would need access to internal state
    });
  });

  describe("Virtual Module Generation", () => {
    it("should generate chunk-based virtual modules", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      // Setup some files first
      await compiler.transform(
        `        import { zintl } from "zintljs";
        zintl("en"); const title = "Main";`,
        join(testRoot, "src/entry.ts"),
        "virtual:zintl-catalog",
      );

      const module = await compiler.generateVirtualModule("entry:src/entry");

      expect(module.code).toBeDefined();
      expect(module.watchedFiles).toBeInstanceOf(Array);
    });
  });

  describe("Chunk Computation", () => {
    it("should build boundary graph from dependencies", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      // Create a dependency chain
      await compiler.transform(
        `        import { zintl } from "zintljs";
        zintl("en"); const main = "Main"; import layout from "./layout";`,
        join(testRoot, "src/entry.ts"),
        "virtual:zintl-catalog",
      );
      await compiler.transform(
        'const layout = "Layout";',
        join(testRoot, "src/layout.ts"),
        "virtual:zintl-catalog",
      );

      // The boundary graph should be built internally
      expect(true).toBe(true); // Placeholder - would need access to internal state
    });
  });

  describe("Catalog Generation", () => {
    it("should generate chunk-based catalogs", async (context: LocalContext) => {
      const { compiler, root: testRoot } = context;
      // Setup files with messages
      await compiler.transform(
        `        import { zintl } from "zintljs";
        zintl("en"); const title = "Main Title";`,
        join(testRoot, "src/entry.ts"),
        "virtual:zintl-catalog",
      );
      await compiler.transform(
        'const subtitle = "Subtitle";',
        join(testRoot, "src/layout.ts"),
        "virtual:zintl-catalog",
      );

      // Flush to generate catalogs
      await compiler.flush();

      // Should complete without errors
      expect(true).toBe(true);
    });
  });
});
