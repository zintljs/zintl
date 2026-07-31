import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTestDir } from "../helpers/fs.js";

type LocalContext = {
  compiler: ZintlCompiler;
  root: string;
};

describe("Zintl Compiler - Manifest & I/O Determinism", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-manifest-test-");
    context.compiler = createTestCompiler(
      {
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      context.root,
      true,
    );
  });

  it("should generate deterministic manifest regardless of insertion order", async ({
    compiler,
    root,
  }: LocalContext) => {
    const manifestPath = (compiler as any).io.manifestPath;

    const codeA = 'document.body.innerHTML = "Welcome";';
    const codeB = 'document.body.innerHTML = "Goodbye";';

    // 1. First run: Add Boundary A then Boundary B
    await compiler.transform(codeA, join(root, "A.ts"));
    await compiler.transform(codeB, join(root, "B.ts"));
    await compiler.flush();
    const manifest1 = await readFile(manifestPath, "utf-8");

    // 2. Clear state and run again with reversed order
    (compiler as any).messages.internalManifest = {};
    (compiler as any).messages.metadataGraph = {};
    (compiler as any).messages.dependencyGraph = {};
    (compiler as any).messages.boundaryOwnership.clear();
    (compiler as any).observationCache = {};
    (compiler as any).hashCache = {};

    await compiler.transform(codeB, join(root, "B.ts"));
    await compiler.transform(codeA, join(root, "A.ts"));
    await compiler.flush();
    const manifest2 = await readFile(manifestPath, "utf-8");

    expect(manifest1).toBe(manifest2);

    // Verify keys are actually sorted and present
    const parsed = JSON.parse(manifest1);
    const keys = Object.keys(parsed.manifest).filter((k) => !k.includes("node_modules"));
    expect(keys).toContain("A");
    expect(keys).toContain("B");
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it("should skip writing files if content is identical", async ({
    compiler,
    root,
  }: LocalContext) => {
    const code = 'document.body.innerHTML = "Hello";';
    await compiler.transform(code, join(root, "main.ts"));
    await compiler.flush();

    const manifestPath = (compiler as any).io.manifestPath;
    const catalogPath = compiler.getCatalogPath("main", "ar")!;
    const schemaPath = compiler.getSchemaPath("main")!;

    // Ensure files exist
    expect(await (compiler as any).io.exists(manifestPath)).toBe(true);
    expect(await (compiler as any).io.exists(catalogPath)).toBe(true);
    expect(await (compiler as any).io.exists(schemaPath)).toBe(true);

    const mtimeManifest = (await stat(manifestPath)).mtimeMs;
    const mtimeCatalog = (await stat(catalogPath)).mtimeMs;
    const mtimeSchema = (await stat(schemaPath)).mtimeMs;

    // Wait a bit to ensure mtime would change if written
    await new Promise((r) => setTimeout(r, 10));

    // Flush again without changes
    await compiler.flush();

    expect((await stat(manifestPath)).mtimeMs).toBe(mtimeManifest);
    expect((await stat(catalogPath)).mtimeMs).toBe(mtimeCatalog);
    expect((await stat(schemaPath)).mtimeMs).toBe(mtimeSchema);
  });

  it("should sort catalog keys alphabetically", async ({ compiler, root }: LocalContext) => {
    // Add messages in non-alphabetical order
    await compiler.transform('document.body.innerHTML = "Zebra";', join(root, "Z.ts"));
    await compiler.transform('document.body.innerHTML = "Apple";', join(root, "A.ts"));
    await compiler.flush();

    const catalogPath = compiler.getCatalogPath("A", "ar")!;
    await readFile(catalogPath, "utf-8");

    // "Apple" should come before "Zebra" if it was a shared catalog,
    // but here A and Z are separate boundaries.
    // Let's use a single boundary with multiple messages.

    await compiler.transform(
      'document.body.innerHTML = "Zebra"; document.body.innerHTML = "Apple";',
      join(root, "Mixed.ts"),
    );
    await compiler.flush();

    const mixedPath = compiler.getCatalogPath("Mixed", "ar")!;
    const mixedCatalog = JSON.parse(await readFile(mixedPath, "utf-8"));
    const mixedKeys = Object.keys(mixedCatalog).filter((k) => k !== "$schema");

    expect(mixedKeys).toEqual(["Apple", "Zebra"]);
  });

  it("should ensure all locales are present in a multilingual catalog", async ({
    root,
  }: LocalContext) => {
    // Fresh compiler with multilingual catalog format
    const compiler = createTestCompiler(
      {
        locales: ["en", "ar", "es"],
        outputDir: "locales",
        catalogFormat: "i18n.json",
      },
      root,
      true,
    );

    await compiler.transform('document.body.innerHTML = "Hello";', join(root, "main.ts"));
    await compiler.flush();

    const catalogPath = join(root, "locales", "i18n.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));

    expect(catalog["Hello"]).toBeDefined();
    expect(catalog["Hello"]["ar"]).toBe("");
    expect(catalog["Hello"]["es"]).toBe("");
  });
});
