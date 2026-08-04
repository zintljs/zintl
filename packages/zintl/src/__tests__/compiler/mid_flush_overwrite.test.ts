import { describe, it, expect, vi } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { createTestDir } from "../helpers/fs.js";

/**
 * Reproduces the `hmr-hammer` CI flake: rapid edits to the same boundary
 * leave the DOM (and here, the catalog on disk) stuck on a stale value
 * forever, even though a newer edit landed.
 *
 * `runFlush` (packages/compiler/src/index.ts) snapshots `dirtyBoundaries`
 * into `adopted` before it writes catalogs, then — once the write is done —
 * deletes every id in `adopted` from `dirtyBoundaries`. That delete is
 * unconditional: it does not check whether the boundary was re-dirtied by a
 * *newer* edit that arrived after this flush already read/wrote its stale
 * content. `hmr-hammer`'s rapid edits only overlap a single flush reliably
 * under CI's slower scheduling, which is why this never reproduces locally.
 *
 * This test forces that overlap directly, inside one real `flush()` call, by
 * hooking the exact point `runFlush` writes a boundary's catalog
 * (`catalog.syncPathCatalogs`) and firing the "next" edit from inside it —
 * after the write, before `runFlush`'s own cleanup runs.
 */
describe("Zintl Compiler - mid-flush overwrite", () => {
  it("does not lose an edit that lands after this flush's catalog write but before its dirty-cleanup", async () => {
    const root = await createTestDir("zintl-mid-flush-race-");
    await mkdir(join(root, "src"), { recursive: true });
    const compiler: ZintlCompiler = createTestCompiler(
      { locales: ["en", "ar"], sourceLocale: "en", outputDir: "locales", verifyIntegrity: false },
      root,
      true,
    );
    await compiler.setup();

    const filePath = join(root, "src/hammer.ts");
    const codeStale = `
      import { zintl, t } from "zintljs";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("Hammer 4"));
    `;
    const codeFresh = `
      import { zintl, t } from "zintljs";
      zintl(Math.random() > 0.5 ? "ar" : "en");
      console.log(t("HMR Hammer works!"));
    `;

    // Establish the boundary with the stale content.
    await compiler.transform(codeStale, filePath, "virtual:zintl/inject");

    // Land the fresh edit strictly between this flush's catalog write and its
    // own dirty-boundary cleanup — the exact window `adopted` does not guard.
    const originalSync = compiler.catalog.syncPathCatalogs.bind(compiler.catalog);
    let injected = false;
    vi.spyOn(compiler.catalog, "syncPathCatalogs").mockImplementation(async (...args: any[]) => {
      const result = await (originalSync as any)(...args);
      if (!injected) {
        injected = true;
        await compiler.transform(codeFresh, filePath, "virtual:zintl/inject");
      }
      return result;
    });

    await compiler.flush();

    const bId = "src/hammer";
    const catalogPath = compiler.getCatalogPath(bId, "ar")!;
    const catalogAfterFirstFlush = JSON.parse(await readFile(catalogPath, "utf-8"));

    // The fresh edit must still be pending — nothing has flushed it yet.
    expect([...compiler.dirtyBoundaries]).toContain(bId);
    expect(catalogAfterFirstFlush).not.toHaveProperty("HMR Hammer works!");

    // A later, ordinary flush (as HMR's debounce would trigger) must pick up
    // the fresh edit. If the boundary's dirty flag was wiped by the first
    // flush, this does nothing and the catalog is stuck on "Hammer 4" forever.
    await compiler.flush();

    const catalogAfterSecondFlush = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalogAfterSecondFlush).toHaveProperty("HMR Hammer works!");
  });
});
