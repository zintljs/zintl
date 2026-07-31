import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { appendFileSync, existsSync } from "node:fs";

import { createTestDir, type TestContext } from "../helpers/fs.js";

describe("ZintlCompiler - Split-Brain (Disk Collision)", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zintl-split-brain-");
  });

  it("should merge translations from multiple boundaries into the same file", async (context: TestContext) => {
    const root = context.root!;
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[path].[locale].json", // Both src/App:A and src/App:B will map to src/App.ar.json
        locales: ["en", "ar"],
      },
      root,
      true,
    );

    await compiler.setup();

    // Transform boundary A
    await compiler.transform(
      'import { t, zintl } from "zintljs"; zintl("ar"); const x = t("Hello A");',
      join(root, "src/App.ts"),
    );

    // Manually trigger flush (usually debounced)
    await compiler.flush();

    const catalogPath = join(root, "locales/src/App.ar.json");
    const logFile = join(root, "debug.log");
    const log = (msg: string) => appendFileSync(logFile, msg + "\n");
    log("Catalog Path: " + catalogPath);
    log("Dirty Boundaries: " + Array.from((compiler as any).messages.dirtyBoundaries).join(", "));
    log("Manifest: " + JSON.stringify((compiler as any).messages.internalManifest, null, 2));

    expect(existsSync(catalogPath)).toBe(true);
    let catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog["Hello A"]).toBe("");

    // Transform boundary B (nested in same file or another file that maps to same path)
    // Here we simulate a second boundary that would collide if not handled
    // We use a different file but same catalog path to prove the point
    await compiler.transform(
      'import { t, zintl } from "zintljs"; zintl("ar"); const y = t("Hello B");',
      join(root, "src/App.ts"), // Overwriting App.ts with new content that has different message
    );

    // Wait, if I overwrite App.ts, boundary ID might stay the same if it's the same file.
    // Let's use two different files that map to the same catalog.
    await compiler.transform('const x = zintl("Hello A");', join(root, "src/App.A.ts"));
    await compiler.transform('const y = zintl("Hello B");', join(root, "src/App.B.ts"));

    // Set catalog format to something that collides
    // Actually, I'll use a custom function to force collision
    const root2 = join(root, "c2");
    const compiler2 = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: () => "shared.ar.json",
        locales: ["en", "ar"],
      },
      root2,
      true,
    );
    await compiler2.setup();

    await compiler2.transform('import { t } from "zintljs"; t("Hello A")', join(root2, "src/A.ts"));
    await compiler2.flush();

    await compiler2.transform('import { t } from "zintljs"; t("Hello B")', join(root2, "src/B.ts"));
    await compiler2.flush();

    const sharedPath = join(root2, "locales/shared.ar.json");
    catalog = JSON.parse(await readFile(sharedPath, "utf-8"));

    // WITHOUT the fix, "Hello A" would be overwritten by "Hello B"
    // WITH the fix, both should be present
    expect(catalog["Hello A"]).toBeDefined();
    expect(catalog["Hello B"]).toBeDefined();
  });
});
