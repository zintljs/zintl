import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Compiler Optimizations", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-opt-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    context.compiler = createTestCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      true,
    );
  });

  it("should pre-populate caches during discover()", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const mainPath = join(root, "src/main.ts");
    const code = 'import { zintl } from "zintl"; zintl("en"); console.log("hello");';
    await writeFile(mainPath, code);

    // Verify cache is empty
    expect(Object.keys((compiler as any).observationCache)).toHaveLength(0);

    await compiler.discover();

    // Verify cache is populated
    expect((compiler as any).observationCache[mainPath]).toBeDefined();
    expect((compiler as any).observationCache[mainPath].anchors).toHaveLength(1);
  });

  it("should bypass observation when file hash matches (Observation Cache)", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const mainPath = join(root, "src/main.ts");
    const code = 'console.log("hello");';
    await compiler.transform(code, mainPath);

    const firstObservation = (compiler as any).observationCache[mainPath];
    expect(firstObservation).toBeDefined();

    // Now transform again with same code
    await compiler.transform(code, mainPath);

    const secondObservation = (compiler as any).observationCache[mainPath];
    // Reference should be identical if cached
    expect(secondObservation).toBe(firstObservation);
  });

  it("should early-return for non-zintl files (Needs Transform heuristic)", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const mainPath = join(root, "src/main.ts");
    const code = 'console.log("no zintl here");';

    // First time it will be observed
    const result = await compiler.transform(code, mainPath);
    expect(result).toBeUndefined(); // No transformation needed

    // Re-transforming should still be undefined (cached and heuristic)
    const result2 = await compiler.transform(code, mainPath);
    expect(result2).toBeUndefined();
  });

  it("should skip graph synchronization during discovery phase", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const mainPath = join(root, "src/main.ts");
    const code = 'import { zintl } from "zintl"; zintl("en");';
    await writeFile(mainPath, code);

    // If it synchronized, graph would be populated
    await compiler.discover();

    // Graph should be synchronized ONCE at the end of discovery
    expect(compiler.boundaryGraph).toBeDefined();
    expect(compiler.boundaryGraph?.nodes.size).toBeGreaterThan(0);
  });
});
