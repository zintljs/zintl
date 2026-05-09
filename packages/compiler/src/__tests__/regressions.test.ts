import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Zintl Regressions: System Gate", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-regression-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    context.compiler = new ZintlCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true, // Dev mode
    );
    await context.compiler.setup();
  });

  it("Regression: Workspace Isolation - should NOT prune files outside of current outputDir", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const localesDir = join(root, "locales");
    const otherDir = join(root, "other-locales");
    await mkdir(localesDir, { recursive: true });
    await mkdir(otherDir, { recursive: true });

    // 1. Create a file in 'other-locales' (simulating another project/test)
    const otherFile = join(otherDir, "ar.json");
    await writeFile(otherFile, JSON.stringify({ test: "preserved" }));

    // 2. Add an entry to the current project and flush
    const entryPath = join(root, "src/main.ts");
    await compiler.transform(`import { zintl } from "zintl"; zintl();`, entryPath);
    await compiler.flush();

    // 3. Verify that 'other-locales' is untouched
    const otherExists = existsSync(otherFile);
    expect(otherExists).toBe(true);

    // 4. Verify current locales are written
    // Let's check the messages were tracked
    expect(compiler.getAffectedChunks("src/main")).toContain("entry:b_src_main");
  });

  it("Regression: HMR Affected Chunks - should include boundary and lazy variants for surgical invalidation", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const parentPath = join(root, "src/main.ts");
    const childPath = join(root, "src/child.ts");

    // Parent with nested anchor and STATIC import
    const parentCode = `import { zintl } from "zintl"; import "./child"; async function render() { await zintl(); }`;
    const childCode = `import { t } from "zintl"; export const msg = t("Hello");`;

    await compiler.transform(childCode, childPath);
    await compiler.transform(parentCode, parentPath);
    await compiler.syncGraphs();

    const affected = compiler.getAffectedChunks("src/child");

    // Crucial: it should find the entry that reaches it
    expect(affected).toContain("entry:b_src_main_render");

    // Crucial: it should include boundary/lazy IDs for surgical Vite invalidation
    const childSafeId = compiler.getSafeBoundaryId("src/child");
    expect(affected).toContain(`boundary:${childSafeId}`);
    expect(affected).toContain(`lazy:${childSafeId}`);
  });

  it("Regression: Nested Boundary Dictator - should correctly identify nested zintl() as entry points", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `
      export async function render(locale) {
        const { zintl } = await import("zintl");
        await zintl(locale);
      }
    `;
    const path = join(root, "src/main.ts");
    await compiler.transform(code, path);
    await compiler.syncGraphs();

    const nodes = Array.from(compiler.boundaryGraph!.nodes.values());
    const renderNode = nodes.find((n) => n.id === "src/main:render");

    expect(renderNode).toBeDefined();
    // This was the bug: nested anchors must be recognized as dictators/roots
    expect(compiler.boundaryGraph!.entries.has("src/main:render")).toBe(true);
  });

  it("Regression: Smart Manager Synchronous Boost - should include all static tree in entry manager", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const entryPath = join(root, "src/entry.ts");
    const sharedPath = join(root, "src/shared.ts");

    const entryCode = `import { zintl } from "zintl"; zintl(); import { msg } from "./shared";`;
    const sharedCode = `import { t } from "zintl"; export const msg = t("Shared Msg");`;

    await compiler.transform(sharedCode, sharedPath);
    await compiler.transform(entryCode, entryPath);
    await compiler.syncGraphs();

    const safeEntryId = compiler.getSafeBoundaryId("src/entry");
    const mod = await compiler.generateVirtualModule(`entry:${safeEntryId}`, "en", true);

    // The shared message MUST be inlined in the entry manager for synchronous boost
    expect(mod.code).toContain("Shared Msg");
    expect(mod.code).toContain("b_src_shared");
  });

  it("Regression: HMR Cache Bypass - should serve updated content in dev without stale cache hits", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const path = join(root, "src/main.ts");
    const safeId = compiler.getSafeBoundaryId("src/main");

    // 1. Initial transform
    await compiler.transform(`import { zintl, t } from "zintl"; zintl(); t("Initial");`, path);
    await compiler.syncGraphs();

    let mod = await compiler.generateVirtualModule(`entry:${safeId}`, "en", true);
    expect(mod.code).toContain("Initial");

    // 2. Update code (HMR simulation)
    await compiler.transform(`import { zintl, t } from "zintl"; zintl(); t("Updated");`, path);
    // Crucial: syncGraphs must be called as it's what the plugin does during HMR or virtual module request
    await compiler.syncGraphs();

    mod = await compiler.generateVirtualModule(`entry:${safeId}`, "en", true);

    // If cache is not bypassed, this would still contain "Initial"
    expect(mod.code).toContain("Updated");
    expect(mod.code).not.toContain("Initial");
  });

  it("Regression: Sub-Boundary Manager Invalidation - should invalidate specific boundary manager when child changes", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const parentPath = join(root, "src/main.ts");
    const childPath = join(root, "src/child.ts");

    const parentCode = `import { zintl } from "zintl"; import "./child"; async function render() { await zintl(); }`;
    const childCode = `import { t } from "zintl"; export const msg = t("Child Msg");`;

    await compiler.transform(childCode, childPath);
    await compiler.transform(parentCode, parentPath);
    await compiler.syncGraphs();

    // Simulating child edit
    const updatedChildCode = `import { t } from "zintl"; export const msg = t("Updated Child");`;
    await compiler.transform(updatedChildCode, childPath);

    const affected = compiler.getAffectedChunks("src/child");

    // It must invalidate the parent entry (since it inlines child)
    expect(affected).toContain("entry:b_src_main_render");

    // It MUST invalidate the boundary manager for the child specifically
    const childSafeId = compiler.getSafeBoundaryId("src/child");
    expect(affected).toContain(`boundary:${childSafeId}`);
  });

  it("Regression: Nested Boundary Pattern Matching - should find chunks via parent path", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const mainPath = join(root, "src/main.ts");
    const code = `import { zintl, t } from "zintl"; async function render() { await zintl(); t("Msg"); }`;

    await compiler.transform(code, mainPath);
    await compiler.syncGraphs();

    // When Vite asks for affected chunks for "src/main" (the file)
    // the compiler must find "src/main:render" (the boundary)
    const affected = compiler.getAffectedChunks("src/main");
    expect(affected).toContain("entry:b_src_main_render");
  });
});
