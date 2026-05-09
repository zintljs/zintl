import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("ZintlCompiler - End-to-End Key Reconciliation", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-compiler-tests-");
    context.root = root;
    // Enable similarity threshold (e.g., 0.8) to allow typo fixing (renames)
    context.compiler = new ZintlCompiler(
      {
        locales: ["en", "es"],
        sourceLocale: "en",
        outputDir: "locales",
        similarityThreshold: 0.5,
        catalogFormat: "[locale]/[name].[func].json", // Include [func] to prevent collisions
      },
      root,
      true,
    );
    await context.compiler.setup();
  });

  it("should detect key renames based on similarity and update translations", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const fileId = "src/components/Banner.tsx";
    const codeV1 = `
      import { zintl } from "zintl";
      zintl("en");
      export function Banner() { return <h1>Welcome to our application!</h1>; }
    `;

    // 1. First Parse
    await compiler.transform(codeV1, join(root, fileId), "virtual:zintl/inject");
    await compiler.flush();

    // Verify initial file written for target locales ONLY
    const enCatalogPathV1 = compiler.getCatalogPath("src/components/Banner:Banner", "en");
    const esCatalogPathV1 = compiler.getCatalogPath("src/components/Banner:Banner", "es");

    // Ghost Mode: English disk file should not exist, Spanish should
    const { stat } = await import("node:fs/promises");
    await expect(stat(enCatalogPathV1!)).rejects.toThrow();
    const stats = await stat(esCatalogPathV1!);
    expect(stats.isFile()).toBe(true);

    // We must manually simulate the translator adding a translation
    // In real env, compiler writes "Welcome to our application!": "" for 'es'
    // Let's read the ES catalog and seed a translation
    let esCatalog = JSON.parse(await readFile(esCatalogPathV1!, "utf-8"));
    esCatalog["Welcome to our application!"] = "¡Bienvenido a nuestra aplicación!";

    // In V1, we need to push it directly into the instance's loadUserCatalog mock/cache or use a new instance
    // Let's force a reload by re-instantiating the compiler with the saved state
    await compiler["safeWriteFile"](esCatalogPathV1!, JSON.stringify(esCatalog));

    // Wait slightly to ensure FS is caught up
    await new Promise((r) => setTimeout(r, 100));

    // 2. Restart compiler to load translator's changes from disk
    const compilerV2 = new ZintlCompiler(
      {
        locales: ["en", "es"],
        sourceLocale: "en",
        outputDir: "locales",
        similarityThreshold: 0.5,
        catalogFormat: "[locale]/[name].[func].json",
      },
      root,
      true,
    );
    await compilerV2.setup(); // loads previous manifest and parses JSONs

    // 3. Second Parse (Code change / Typo fixed)
    const codeV2 = `
      import { zintl } from "zintl";
      zintl("en");
      export function Banner() { return <h1>Welcome to our application.</h1>; }
    `;
    await compilerV2.transform(codeV2, join(root, fileId), "virtual:zintl/inject");
    await compilerV2.flush();

    // 4. Verify translation was preserved under the new key
    const esCatalogV2 = JSON.parse(await readFile(esCatalogPathV1!, "utf-8"));

    expect(esCatalogV2["Welcome to our application."]).toBe("¡Bienvenido a nuestra aplicación!");
    expect(esCatalogV2["Welcome to our application!"]).toBeUndefined(); // Old key is removed
  });
});
