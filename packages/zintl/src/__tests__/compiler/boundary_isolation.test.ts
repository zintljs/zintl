import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler, createTestCompilerWith } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { viteFacet } from "@zintljs/compiler/facets";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

function evalManager(code: string) {
  const cleanCode = code.replace(/\nif \(import\.meta\.hot\) \{[\s\S]*$/, "");
  const objectPart = cleanCode
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n")
    .replace(/^export default /, "")
    .trim()
    .replace(/;$/, "");
  // oxlint-disable-next-line typescript/no-implied-eval
  return new Function(`return (${objectPart})`)();
}

describe("Zintl Compiler: Boundary Isolation", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-compiler-tests-boundary-");
    context.root = root;
    context.compiler = createTestCompilerWith(
      [viteFacet()],
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
        logLevel: "silent",
      },
      root,
      true,
    );
  });

  it("should not merge a nested entry point's catalog into its parent entry point", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const parentCode = `import { zintl } from "zintl"; zintl("en");\nimport "./nested";\ndocument.body.innerHTML = "Parent Content";`;
    const nestedCode = `import { zintl } from "zintl"; zintl("en");\ndocument.body.innerHTML = "Nested Content";`;

    // Process nested first to populate internal state
    await compiler.transform(nestedCode, join(root, "src/nested.ts"), "virtual:zintl/catalogs");
    // Process parent
    await compiler.transform(parentCode, join(root, "src/parent.ts"), "virtual:zintl/catalogs");

    // Check parent's catalog (entryId is "src/parent")
    const stableId = compiler.getBoundaryId("src/parent");
    const parentCatalogMod = await compiler.generateVirtualModule(`entry:${stableId}`);
    const parentManager = evalManager(parentCatalogMod.code);
    const parentCatalog = parentManager.loader("en")[compiler.getSafeBoundaryId("src/parent")];

    // Verify it contains parent's message but NOT nested's message
    expect(parentCatalog).toHaveProperty("Parent Content");
    expect(parentCatalog).not.toHaveProperty("Nested Content");

    // Check nested's catalog (entryId is "src/nested")
    const stableIdNested = compiler.getBoundaryId("src/nested");
    const nestedCatalogMod = await compiler.generateVirtualModule(`entry:${stableIdNested}`);
    const nestedManager = evalManager(nestedCatalogMod.code);
    const nestedCatalog = nestedManager.loader("en")[compiler.getSafeBoundaryId("src/nested")];

    // Verify it contains nested's message
    expect(nestedCatalog).toHaveProperty("Nested Content");
  });

  it("should maintain isolation after a restart (persistent metadata)", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    // 1. First session: process files and save manifest
    const p1Code = `import { zintl } from "zintl"; zintl("en");\nimport "./c1";\ndocument.body.innerHTML = "P1";`;
    const c1Code = `import { zintl } from "zintl"; zintl("en");\ndocument.body.innerHTML = "C1";`;

    await compiler.transform(p1Code, join(root, "src/p1.ts"), "virtual:zintl/catalogs");
    await compiler.transform(c1Code, join(root, "src/c1.ts"), "virtual:zintl/catalogs");
    await compiler.flush();

    // 2. Second session: new compiler instance loading the saved manifest
    const compiler2 = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true,
    );
    await compiler2.setup();

    // Check parent's catalog without re-transforming
    const stableIdP1 = compiler2.getBoundaryId("src/p1");
    const p1CatalogMod = await compiler2.generateVirtualModule(`entry:${stableIdP1}`);
    const p1Manager = evalManager(p1CatalogMod.code);
    const p1Catalog = p1Manager.loader("en")[compiler2.getSafeBoundaryId("src/p1")];

    // Verify it still isolates C1
    expect(p1Catalog).toHaveProperty("P1");
    expect(p1Catalog).not.toHaveProperty("C1");
  });
  it("should generate dynamic imports with @vite-ignore in dev mode", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `import { zintl } from "zintl"; zintl();`;

    await compiler.transform(code, join(root, "src/entry.ts"), "virtual:zintl/catalogs");
    await compiler.flush();

    const stableId = compiler.getBoundaryId("src/entry");
    const mod = await compiler.generateVirtualModule(`entry:${stableId}`);

    // The manager should contain the @vite-ignore comment for dynamic imports
    expect(mod.code).toContain("/* @vite-ignore */");
  });
});
