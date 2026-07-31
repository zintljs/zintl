import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { join, dirname } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

describe("Quantum Variable Healing", () => {
  beforeEach(async (context: TestContext) => {
    const root = await createTestDir("zintl-healing-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "locales"), { recursive: true });
  });

  it("should automatically heal variable names in target translations when source variables are renamed", async (context: TestContext) => {
    const root = context.root!;
    const compiler = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      false, // Production mode for baking
    );

    // 1. Initial State: Source uses 'name'
    const codeV1 = "import 'zintljs'; export const Hero = () => <div>Hello {name}</div>;";
    const filePath = join(root, "src/Hero.tsx");
    await writeFile(filePath, codeV1);

    // Initial extraction to set the baseline manifest
    await compiler.transform(codeV1, filePath, "virtual:zintl/content");

    // 2. Add an Arabic translation using '{name}'
    const bId = "src/Hero.tsx:Hero";
    const arPath = compiler.getCatalogPath(bId, "ar")!;
    await mkdir(dirname(arPath), { recursive: true });
    await writeFile(arPath, JSON.stringify({ "Hello {name}": "أهلاً {name}" }));

    await (compiler as any).flush();

    // 3. Refactor: Rename variable from 'name' to 'fullName'
    const codeV2 = "import 'zintljs'; export const Hero = () => <div>Hello {fullName}</div>;";
    await writeFile(filePath, codeV2);

    // Trigger reconciliation
    await compiler.transform(codeV2, filePath, "virtual:zintl/content");
    await (compiler as any).flush();

    // 4. Verification: Check if ar.json was healed
    const arContent = JSON.parse(await readFile(arPath!, "utf-8"));

    // The key should have updated from 'Hello {name}' to 'Hello {fullName}'
    expect(arContent["Hello {name}"]).toBeUndefined();
    expect(arContent["Hello {fullName}"]).toBeDefined();

    // THE QUANTUM LEAP: The internal placeholder should have updated to {fullName}
    expect(arContent["Hello {fullName}"]).toBe("أهلاً {fullName}");

    // 5. Verification: Check baked output
    const safeBId = compiler.getSafeBoundaryId(bId);

    // Verify Manager has 'ar' entry
    const manager = await compiler.generateVirtualModule(safeBId);
    expect(manager.code).toContain("ar");

    // Verify 'ar' content has been healed and baked correctly
    const arModule = await compiler.generateVirtualModule(safeBId, "ar");
    const arCode = arModule.code;

    expect(arCode).toContain("fullName");
    expect(arCode).not.toContain("name");
    expect(arCode).toContain("أهلاً");
  });
});
