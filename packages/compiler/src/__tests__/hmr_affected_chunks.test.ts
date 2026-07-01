import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Zintl Compiler - HMR Affected Chunks", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-hmr-chunks-test-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    context.compiler = new ZintlCompiler(
      {
        locales: ["en", "ar"],
        outputDir: "locales",
        adapters: ["vue"],
        extensions: [".ts", ".tsx", ".js", ".jsx", ".html", ".vue"],
      },
      root,
      true, // isDev
    );
  });

  it("should identify all entry chunks as affected when b_assets changes", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    // Create a few entry points
    await writeFile(join(root, "src/main.ts"), 'import { zintl } from "zintl"; zintl();');
    await writeFile(join(root, "src/about.ts"), 'import { zintl } from "zintl"; zintl();');

    await compiler.discover();
    await compiler.flush();

    // Verify b_assets is mapped to both entries in dev mode
    const affected = compiler.getAffectedChunks("b_assets");

    const mainId = compiler.getSafeBoundaryId("src/main.ts");
    const aboutId = compiler.getSafeBoundaryId("src/about.ts");

    expect(affected).toContain(`entry:${mainId}`);
    expect(affected).toContain(`entry:${aboutId}`);

    // Also check that it returns the boundary/lazy versions for self-invalidation
    expect(affected).toContain("boundary:b_assets");
  });

  it("should correctly identify chunks affected by a specific boundary", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    await writeFile(
      join(root, "src/main.ts"),
      'import { zintl } from "zintl"; import { getMsg } from "./shared"; zintl(); getMsg();',
    );
    await writeFile(
      join(root, "src/shared.ts"),
      'import { zintl } from "zintl"; export function getMsg() { return zintl("hello"); }',
    );

    await compiler.transform(
      await readFile(join(root, "src/main.ts"), "utf-8"),
      join(root, "src/main.ts"),
      "virtual:zintl/catalogs",
    );
    await compiler.transform(
      await readFile(join(root, "src/shared.ts"), "utf-8"),
      join(root, "src/shared.ts"),
      "virtual:zintl/catalogs",
    );

    await compiler.discover();
    await compiler.flush();

    const rawSharedId = "src/shared";
    const safeSharedId = compiler.getSafeBoundaryId("src/shared.ts");

    const affected = compiler.getAffectedChunks(rawSharedId);
    expect(affected).toContain("entry:b_src_shared_getMsg");
    expect(affected).toContain(`boundary:${safeSharedId}`);
  });

  it("should return the entry point manager for non-entry components that contain translations", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    await writeFile(
      join(root, "src/main.ts"),
      'import { zintl } from "zintl"; import "./Component.vue"; zintl();',
    );
    await writeFile(
      join(root, "src/Component.vue"),
      "<template><div>translate me</div></template>",
    );

    await compiler.transform(
      await readFile(join(root, "src/main.ts"), "utf-8"),
      join(root, "src/main.ts"),
    );
    await compiler.transform(
      await readFile(join(root, "src/Component.vue"), "utf-8"),
      join(root, "src/Component.vue"),
    );

    await compiler.discover();
    await compiler.syncGraphs(true);

    const componentBoundaryId = "b_src_Component_vue";
    const mainEntrySafeId = compiler.getSafeBoundaryId("src/main.ts");

    const affected = compiler.getAffectedChunks(componentBoundaryId);
    expect(affected).toContain(`entry:${mainEntrySafeId}`);
  });
});
