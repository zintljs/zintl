import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintl/compiler";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("The Translation Hive (Global Resuscitation)", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-hive-tests-");
    context.root = root;
    context.compiler = createTestCompiler(
      {
        locales: ["en", "ar"],
        sourceLocale: "en",
        outputDir: "locales",
        logLevel: "silent",
        verifyIntegrity: false,
      },
      root,
      false, // Dev mode disabled for structural tests
    );
    await context.compiler.setup();
  });

  it("should capture translations into the Hive and restore them globally across boundaries", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const fileA = join(root, "src/a.ts");
    const fileB = join(root, "src/b.ts");

    await mkdir(join(root, "src"), { recursive: true });

    // 1. Create file A with a translatable string
    const codeA1 = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Global Memory"));
    `;

    await compiler.transform(codeA1, fileA, "virtual:zintl/inject");
    await compiler.flush();

    const catalogPathA = compiler.getCatalogPath("src/a", "ar")!;

    // Simulate translator manual work on File A
    const catA1 = JSON.parse(await readFile(catalogPathA, "utf-8"));
    catA1["Global Memory"] = "ذاكرة عالمية";
    await writeFile(catalogPathA, JSON.stringify(catA1, null, 2));

    // Force a harvest of this manual translation into the Hive
    (compiler as any).dirtyBoundaries.add("src/a");
    await compiler.flush();

    compiler.flushCache();

    // 2. Remove the string from file A (simulating a deletion/refactor)
    // The previous state had the string, the new state does not.
    // When the compiler flushes, it loads the user catalog from disk, harvests the translation into the hive,
    // and then deletes the key from the user catalog.
    const codeA2 = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log("No memory here");
    `;

    await compiler.transform(codeA2, fileA, "virtual:zintl/inject");
    await compiler.flush();

    expect(existsSync(catalogPathA)).toBe(false);

    // 3. Create a totally new file B that uses the EXACT SAME string.
    const codeB = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Global Memory"));
    `;

    await compiler.transform(codeB, fileB, "virtual:zintl/inject");
    await compiler.flush();

    const catalogPathB = compiler.getCatalogPath("src/b", "ar")!;
    const catB = JSON.parse(await readFile(catalogPathB, "utf-8"));

    // Verify "Global Resuscitation" - The translation from the Hive populated File B instantly!
    expect(catB).toHaveProperty("Global Memory", "ذاكرة عالمية");
  });

  it("should capture and restore complex ICU objects globally", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const fileA = join(root, "src/icu_a.ts");
    const fileB = join(root, "src/icu_b.ts");
    await mkdir(join(root, "src"), { recursive: true });

    const codeA = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Count is {counter}"));
    `;

    await compiler.transform(codeA, fileA, "virtual:zintl/inject");
    await compiler.flush();

    const catalogPathA = compiler.getCatalogPath("src/icu_a", "ar")!;
    const icuObject = {
      "counter=1": "العدد واحد",
      "counter=0": "صفر",
      "counter>1": "العدد هو {counter}",
    };

    // Simulate translator providing ICU object
    const catA = JSON.parse(await readFile(catalogPathA, "utf-8"));
    catA["Count is {counter}"] = icuObject;
    await writeFile(catalogPathA, JSON.stringify(catA, null, 2));

    // Force a re-transform or manually mark as dirty to trigger harvest in flush
    // In a real app, the user would save a file. Here we manually dirty it.
    (compiler as any).dirtyBoundaries.add("src/icu_a");
    await compiler.flush();

    // Now use it in file B
    const codeB = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Count is {counter}"));
    `;

    await compiler.transform(codeB, fileB, "virtual:zintl/inject");
    await compiler.flush();

    const catalogPathB = compiler.getCatalogPath("src/icu_b", "ar")!;
    const catB = JSON.parse(await readFile(catalogPathB, "utf-8"));

    expect(catB).toHaveProperty("Count is {counter}");
    expect(catB["Count is {counter}"]).toEqual(icuObject);
  });

  it("should persist the Hive to disk and reload it between compiler instances", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const fileA = join(root, "src/persist_a.ts");
    await mkdir(join(root, "src"), { recursive: true });

    const codeA = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Persistent Memory"));
    `;

    await compiler.transform(codeA, fileA, "virtual:zintl/inject");
    await compiler.flush();

    const catalogPathA = compiler.getCatalogPath("src/persist_a", "ar")!;
    const catA = JSON.parse(await readFile(catalogPathA, "utf-8"));
    catA["Persistent Memory"] = "ذاكرة مستمرة";
    await writeFile(catalogPathA, JSON.stringify(catA, null, 2));

    (compiler as any).dirtyBoundaries.add("src/persist_a");
    await compiler.flush();

    // 2. New compiler instance
    const compiler2 = createTestCompiler(
      {
        locales: ["en", "ar"],
        sourceLocale: "en",
        outputDir: "locales",
      },
      root,
      false,
    );
    await compiler2.setup();

    // The Hive should have "Persistent Memory" even if File A's catalog is NOT on disk for the new instance
    const catalogPathB = compiler2.getCatalogPath("src/persist_b", "ar")!;
    const fileB = join(root, "src/persist_b.ts");
    const codeB = `
      import { zintl, t } from "zintl";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Persistent Memory"));
    `;

    await compiler2.transform(codeB, fileB, "virtual:zintl/inject");
    await compiler2.flush();

    const catB = JSON.parse(await readFile(catalogPathB, "utf-8"));
    expect(catB).toHaveProperty("Persistent Memory", "ذاكرة مستمرة");
  });
});
