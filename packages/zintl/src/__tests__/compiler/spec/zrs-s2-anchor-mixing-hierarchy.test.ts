import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../../helpers/compiler.js";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../../helpers/fs.js";
import { readFile, writeFile } from "node:fs/promises";

describe("ZRS §2: Anchor Mixing Hierarchy", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zrs-mixing-");
  });

  it("should handle mixed tiers: Dynamic Parent -> Static Child -> Dynamic Grandchild", async (context: TestContext) => {
    const root = context.root!;
    const compiler = createTestCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const parentCode = `import "./child"; const lang = "ar"; await zintl(lang); document.body.innerHTML = "Parent Msg";`;
    const childCode = `import "./grandchild"; await zintl("ar"); document.body.innerHTML = "Child Msg";`;
    const grandchildCode = `const lang = "ar"; await zintl(lang); document.body.innerHTML = "Grandchild Msg";`;

    const parentPath = join(root, "src/parent.ts");
    const childPath = join(root, "src/child.ts");
    const grandchildPath = join(root, "src/grandchild.ts");

    // 1. Initial Extraction
    await compiler.transform(grandchildCode, grandchildPath);
    await compiler.transform(childCode, childPath);
    await compiler.transform(parentCode, parentPath);
    await compiler.flush();

    // 2. Add translations to catalogs
    const locales = ["ar"];
    for (const locale of locales) {
      // Parent
      const pCatPath = compiler.getCatalogPath("src/parent", locale)!;
      const pCat = JSON.parse(await readFile(pCatPath, "utf-8"));
      pCat["Parent Msg"] = "رسالة الأب";
      await writeFile(pCatPath, JSON.stringify(pCat, null, 2));

      // Child
      const cCatPath = compiler.getCatalogPath("src/child", locale)!;
      const cCat = JSON.parse(await readFile(cCatPath, "utf-8"));
      cCat["Child Msg"] = "رسالة الابن";
      await writeFile(cCatPath, JSON.stringify(cCat, null, 2));

      // Grandchild
      const gCatPath = compiler.getCatalogPath("src/grandchild", locale)!;
      const gCat = JSON.parse(await readFile(gCatPath, "utf-8"));
      gCat["Grandchild Msg"] = "رسالة الحفيد";
      await writeFile(gCatPath, JSON.stringify(gCat, null, 2));
    }

    compiler.flushCache();

    // 3. Final Transformation & Validation
    const parentRes = await compiler.transform(parentCode, parentPath);
    const childRes = await compiler.transform(childCode, childPath);
    const grandchildRes = await compiler.transform(grandchildCode, grandchildPath);

    // Parent: Dynamic (Governance Tier) -> Should NOT be baked
    expect(parentRes?.code).toContain("_t(");
    expect(parentRes?.code).not.toContain("رسالة الأب");

    // Child: Static (Baked Tier) -> Should BE baked
    expect(childRes?.code).toContain("رسالة الابن");
    expect(childRes?.code).not.toContain("zintl(");

    // Grandchild: Dynamic (Governance Tier) -> Should NOT be baked
    expect(grandchildRes?.code).toContain("_t(");
    expect(grandchildRes?.code).not.toContain("رسالة الحفيد");
  });

  it("should handle mixed siblings: Dynamic Parent -> {Static Child, Dynamic Child}", async (context: TestContext) => {
    const root = context.root!;
    const compiler = createTestCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const parentCode = `import "./staticChild"; import "./dynamicChild"; const lang = "ar"; await zintl(lang); document.body.innerHTML = "Parent";`;
    const staticChildCode = `await zintl("ar"); document.body.innerHTML = "Static Child";`;
    const dynamicChildCode = `const lang = "ar"; await zintl(lang); document.body.innerHTML = "Dynamic Child";`;

    const parentPath = join(root, "src/parent.ts");
    const staticPath = join(root, "src/staticChild.ts");
    const dynamicPath = join(root, "src/dynamicChild.ts");

    await compiler.transform(staticChildCode, staticPath);
    await compiler.transform(dynamicChildCode, dynamicPath);
    await compiler.transform(parentCode, parentPath);
    await compiler.flush();

    // Add translations
    const sCatPath = compiler.getCatalogPath("src/staticChild", "ar")!;
    const sCat = JSON.parse(await readFile(sCatPath, "utf-8"));
    sCat["Static Child"] = "ابن ثابت";
    await writeFile(sCatPath, JSON.stringify(sCat, null, 2));

    const dCatPath = compiler.getCatalogPath("src/dynamicChild", "ar")!;
    const dCat = JSON.parse(await readFile(dCatPath, "utf-8"));
    dCat["Dynamic Child"] = "ابن متغير";
    await writeFile(dCatPath, JSON.stringify(dCat, null, 2));

    compiler.flushCache();

    const staticRes = await compiler.transform(staticChildCode, staticPath);
    const dynamicRes = await compiler.transform(dynamicChildCode, dynamicPath);

    expect(staticRes?.code).toContain("ابن ثابت");
    expect(staticRes?.code).not.toContain("zintl(");

    expect(dynamicRes?.code).toContain("_t(");
    expect(dynamicRes?.code).not.toContain("ابن متغير");
  });

  it("should handle mixed tiers: Static Parent -> Dynamic Child -> Static Grandchild", async (context: TestContext) => {
    const root = context.root!;
    const compiler = createTestCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const parentCode = `import "./child"; await zintl("ar"); document.body.innerHTML = "Parent";`;
    const childCode = `import "./grandchild"; const lang = "ar"; await zintl(lang); document.body.innerHTML = "Child";`;
    const grandchildCode = `await zintl("ar"); document.body.innerHTML = "Grandchild";`;

    const parentPath = join(root, "src/parent.ts");
    const childPath = join(root, "src/child.ts");
    const grandchildPath = join(root, "src/grandchild.ts");

    await compiler.transform(grandchildCode, grandchildPath);
    await compiler.transform(childCode, childPath);
    await compiler.transform(parentCode, parentPath);
    await compiler.flush();

    // Add translations
    const pCatPath = compiler.getCatalogPath("src/parent", "ar")!;
    const pCat = JSON.parse(await readFile(pCatPath, "utf-8"));
    pCat["Parent"] = "أب ثابت";
    await writeFile(pCatPath, JSON.stringify(pCat, null, 2));

    const cCatPath = compiler.getCatalogPath("src/child", "ar")!;
    const cCat = JSON.parse(await readFile(cCatPath, "utf-8"));
    cCat["Child"] = "ابن متغير";
    await writeFile(cCatPath, JSON.stringify(cCat, null, 2));

    const gCatPath = compiler.getCatalogPath("src/grandchild", "ar")!;
    const gCat = JSON.parse(await readFile(gCatPath, "utf-8"));
    gCat["Grandchild"] = "حفيد ثابت";
    await writeFile(gCatPath, JSON.stringify(gCat, null, 2));

    compiler.flushCache();

    const parentRes = await compiler.transform(parentCode, parentPath);
    const childRes = await compiler.transform(childCode, childPath);
    const grandchildRes = await compiler.transform(grandchildCode, grandchildPath);

    expect(parentRes?.code).toContain("أب ثابت");
    expect(parentRes?.code).not.toContain("zintl(");

    expect(childRes?.code).toContain("_t(");
    expect(childRes?.code).not.toContain("ابن متغير");

    expect(grandchildRes?.code).toContain("حفيد ثابت");
    expect(grandchildRes?.code).not.toContain("zintl(");
  });

  it("should handle mixed siblings: Static Parent -> {Static Child, Dynamic Child}", async (context: TestContext) => {
    const root = context.root!;
    const compiler = createTestCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const parentCode = `import "./staticChild"; import "./dynamicChild"; await zintl("ar"); document.body.innerHTML = "Parent";`;
    const staticChildCode = `await zintl("ar"); document.body.innerHTML = "Static Child";`;
    const dynamicChildCode = `const lang = "ar"; await zintl(lang); document.body.innerHTML = "Dynamic Child";`;

    const parentPath = join(root, "src/parent.ts");
    const staticPath = join(root, "src/staticChild.ts");
    const dynamicPath = join(root, "src/dynamicChild.ts");

    await compiler.transform(staticChildCode, staticPath);
    await compiler.transform(dynamicChildCode, dynamicPath);
    await compiler.transform(parentCode, parentPath);
    await compiler.flush();

    // Add translations
    const pCatPath = compiler.getCatalogPath("src/parent", "ar")!;
    const pCat = JSON.parse(await readFile(pCatPath, "utf-8"));
    pCat["Parent"] = "أب ثابت";
    await writeFile(pCatPath, JSON.stringify(pCat, null, 2));

    const sCatPath = compiler.getCatalogPath("src/staticChild", "ar")!;
    const sCat = JSON.parse(await readFile(sCatPath, "utf-8"));
    sCat["Static Child"] = "ابن ثابت";
    await writeFile(sCatPath, JSON.stringify(sCat, null, 2));

    const dCatPath = compiler.getCatalogPath("src/dynamicChild", "ar")!;
    const dCat = JSON.parse(await readFile(dCatPath, "utf-8"));
    dCat["Dynamic Child"] = "ابن متغير";
    await writeFile(dCatPath, JSON.stringify(dCat, null, 2));

    compiler.flushCache();

    const parentRes = await compiler.transform(parentCode, parentPath);
    const staticRes = await compiler.transform(staticChildCode, staticPath);
    const dynamicRes = await compiler.transform(dynamicChildCode, dynamicPath);

    expect(parentRes?.code).toContain("أب ثابت");
    expect(parentRes?.code).not.toContain("zintl(");

    expect(staticRes?.code).toContain("ابن ثابت");
    expect(staticRes?.code).not.toContain("zintl(");

    expect(dynamicRes?.code).toContain("_t(");
    expect(dynamicRes?.code).not.toContain("ابن متغير");
  });
});
