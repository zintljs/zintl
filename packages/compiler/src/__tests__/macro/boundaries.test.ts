// oxlint-disable typescript/no-implied-eval
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

function evalManager(code: string) {
  const cleanCode = code.replace(/\nif \(import\.meta\.hot\) \{[\s\S]*$/, "");
  const objectPart = cleanCode
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n")
    .replace(/^export default /, "")
    .trim()
    .replace(/;$/, "");
  return new Function(`return (${objectPart})`)();
}
type LocalContext = TestContext & { compiler: ZintlCompiler };
/**
 * Boundary Consolidation & Isolation Reference Suite
 *
 * Verifies the "Rollup" behavior for static imports and the "Opt-out"
 * behavior for nested entries.
 */
describe("Macro Boundaries: Rollup & Isolation", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-boundaries-");
    context.compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"], outputDir: "locales" },
      context.root,
      true,
    );
  });

  it("should rollup STATIC dependencies without their own zintl()", async ({
    compiler,
    root,
  }: LocalContext) => {
    const parentCode = `import { zintl } from "zintl"; zintl(); import "./child"; document.body.innerHTML = "Parent";`;
    const childCode = `document.body.innerHTML = "Child";`;

    await compiler.transform(childCode, join(root, "src/child.ts"), "target");
    await compiler.transform(parentCode, join(root, "src/parent.ts"), "target");
    await compiler.flush();

    // Parent entry chunk should contain both "Parent" and "Child"
    const stableId = compiler.getBoundaryId("src/parent");
    const entryMod = await compiler.generateVirtualModule(`entry:${stableId}`);
    const manager = evalManager(entryMod.code);
    const catalog = manager.loader("en");

    expect(catalog[compiler.getSafeBoundaryId("src/parent")]).toHaveProperty("Parent");
    expect(catalog[compiler.getSafeBoundaryId("src/child")]).toHaveProperty("Child");
  });

  it("should NOT rollup STATIC dependencies that have their own zintl() (Isolation)", async ({
    compiler,
    root,
  }: LocalContext) => {
    const parentCode = `import { zintl } from "zintl"; zintl(); import("./child"); document.body.innerHTML = "Parent";`;
    const childCode = `import { zintl } from "zintl"; zintl(); document.body.innerHTML = "Child";`;

    await compiler.transform(childCode, join(root, "src/child.ts"), "target");
    await compiler.transform(parentCode, join(root, "src/parent.ts"), "target");
    await compiler.flush();

    const stableId = compiler.getBoundaryId("src/parent");
    const parentMod = await compiler.generateVirtualModule(`entry:${stableId}`);
    const manager = evalManager(parentMod.code);
    const parentCatalog = manager.loader("en");

    // Parent should have parent string but NOT child string (because child is its own entry)
    expect(parentCatalog[compiler.getSafeBoundaryId("src/parent")]).toHaveProperty("Parent");
    expect(parentCatalog[compiler.getSafeBoundaryId("src/child")]).toBeUndefined();
  });

  it("should identify shared boundaries for common dependencies", async ({
    compiler,
    root,
  }: LocalContext) => {
    // entryA -> shared
    // entryB -> shared
    const entryACode = `import { zintl } from "zintl"; zintl(); import "./shared"; document.body.innerHTML = "A";`;
    const entryBCode = `import { zintl } from "zintl"; zintl(); import "./shared"; document.body.innerHTML = "B";`;
    const sharedCode = `document.body.innerHTML = "Shared Content";`;

    await compiler.transform(sharedCode, join(root, "src/shared.ts"), "target");
    await compiler.transform(entryACode, join(root, "src/entryA.ts"), "target");
    await compiler.transform(entryBCode, join(root, "src/entryB.ts"), "target");
    await compiler.flush();

    const stableIdA = compiler.getBoundaryId("src/entryA");
    const modA = await compiler.generateVirtualModule(`entry:${stableIdA}`);
    const manager = evalManager(modA.code);
    const catA = manager.loader("en");

    // For the anchor locale (en), "shared" SHOULD be inlined in the manager to ensure 0ms start
    expect(catA[compiler.getSafeBoundaryId("src/shared")]).toHaveProperty("Shared Content");
  });
});
