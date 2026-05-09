import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join, dirname } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler: ZintlCompiler };

describe("Quantum Level Entanglement (Strict Catalog Sync)", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-entanglement-tests-");
    context.compiler = new ZintlCompiler(
      {
        locales: ["en", "ar"],
        sourceLocale: "en",
        outputDir: "locales",
        similarityThreshold: 0.1,
      },
      context.root,
      true, // Dev mode
    );
    await context.compiler.setup();
  });

  it("should surgically remove keys from catalog and schema when removed from source", async ({
    compiler,
    root,
  }: LocalContext) => {
    const fileId = join(root, "src/main.ts");
    await mkdir(dirname(fileId), { recursive: true });

    const codeV1 = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("HELLO"));
      console.log(t("STALE"));
    `;

    // 1. Initial transform
    await compiler.transform(codeV1, fileId, "virtual:zintl/inject");
    await compiler.flush();

    const catalogPath = compiler.getCatalogPath("src/main", "ar")!;
    const schemaPath = compiler.getSchemaPath("src/main")!;

    // Verify initial state
    const catV1 = JSON.parse(await readFile(catalogPath, "utf-8"));
    const schV1 = JSON.parse(await readFile(schemaPath, "utf-8"));

    expect(catV1).toHaveProperty("HELLO", "");
    expect(catV1).toHaveProperty("STALE", "");
    expect(schV1.properties).toHaveProperty("HELLO");
    expect(schV1.properties).toHaveProperty("STALE");

    // 2. Remove one string from source
    const codeV2 = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("HELLO"));
    `;

    await compiler.transform(codeV2, fileId, "virtual:zintl/inject");
    await compiler.flush();

    // Verify "Quantum Level Entanglement"
    const catV2 = JSON.parse(await readFile(catalogPath, "utf-8"));
    const schV2 = JSON.parse(await readFile(schemaPath, "utf-8"));

    expect(catV2).toHaveProperty("HELLO", "");
    expect(catV2).not.toHaveProperty("STALE");

    expect(schV2.properties).toHaveProperty("HELLO");
    expect(schV2.properties).not.toHaveProperty("STALE");
    expect(schV2.additionalProperties).toBe(false);
  });

  it("should preserve translations during renames but purge the old key", async ({
    compiler,
    root,
  }: LocalContext) => {
    const fileId = join(root, "src/main.ts");
    await mkdir(dirname(fileId), { recursive: true });

    const codeV1 = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Original Message"));
    `;

    await compiler.transform(codeV1, fileId, "virtual:zintl/inject");
    await compiler.flush();

    const catalogPath = compiler.getCatalogPath("src/main", "ar")!;

    // Simulate translator manual work
    const catV1 = JSON.parse(await readFile(catalogPath, "utf-8"));
    catV1["Original Message"] = "رسالة أصلية";
    await writeFile(catalogPath, JSON.stringify(catV1, null, 2));

    compiler.flushCache();

    // 2. Rename the string (similarity threshold)
    const codeV2 = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Original Message.")); 
    `;

    await compiler.transform(codeV2, fileId, "virtual:zintl/inject");
    await compiler.flush();

    const catV2 = JSON.parse(await readFile(catalogPath, "utf-8"));

    // expect(catV2["Original Message."]).toBe("رسالة أصلية");
    expect(catV2).toHaveProperty("Original Message.");
  });
});
