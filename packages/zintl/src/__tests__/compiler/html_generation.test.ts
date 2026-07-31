import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("HTML Disk Generation", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("html-generation-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/main.ts"), 'import { zintl } from "zintl"; zintl("en");');
    context.compiler = createTestCompiler(
      { locales: ["en", "ar"], outputDir: "locales" },
      root,
      true,
    );
  });

  it("should generate schema and catalog for HTML files", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const htmlCode = `
      <html>
      <head>
        <title>Generation Test</title>
        <meta name="description" content="Test Desc">
        <script type="module" src="/src/main.ts"></script>
      </head>
      </html>
    `;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    const schemaPath = join(root, "locales", ".schemas", "index.html.schema.json");
    const catalogPath = join(root, "locales", "index.html.ar.json");

    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(catalogPath)).toBe(true);

    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.title).toBe("");
    expect(catalog.description).toBe("");
    expect(catalog.dir).toBe("");
    expect(catalog.$schema).toBe(".schemas/index.html.schema.json");
  });

  it("should generate RTL catalog if source HTML is RTL", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const htmlCode = `
      <html dir="rtl">
      <head>
        <title>Arabic Site</title>
        <script type="module" src="/src/main.ts"></script>
      </head>
      </html>
    `;
    await writeFile(join(root, "index.html"), htmlCode);

    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    const catalogPath = join(root, "locales", "index.html.ar.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.dir).toBe("");
  });

  it("should respect manual dir override in existing catalog", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const htmlCode = `<html dir="rtl"><head><title>Test</title><script type="module" src="/src/main.ts"></script></head></html>`;
    await writeFile(join(root, "index.html"), htmlCode);

    // Pre-create catalog with manual override
    await mkdir(join(root, "locales"), { recursive: true });
    await writeFile(
      join(root, "locales/index.html.ar.json"),
      JSON.stringify({
        dir: "ltr", // Manual override to LTR even if source is RTL
      }),
    );

    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    const catalogPath = join(root, "locales", "index.html.ar.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.dir).toBe("ltr"); // Should NOT be overwritten to RTL
  });

  it("should restore HTML metadata from Hive if catalog is deleted", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const htmlCode = `<html><head><title>Hive Test</title><script src="/src/main.ts"></script></head></html>`;
    await writeFile(join(root, "index.html"), htmlCode);

    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    const catalogPath = join(root, "locales", "index.html.ar.json");

    // 1. Manually translate the catalog
    const translated = { title: "تطبيق", description: "وصف", dir: "rtl" };
    await writeFile(catalogPath, JSON.stringify(translated));

    // 2. Flush to harvest into Hive
    await compiler.flush();

    // 3. Delete the catalog file
    const { rm } = await import("node:fs/promises");
    await rm(catalogPath);
    expect(existsSync(catalogPath)).toBe(false);

    // 4. Flush again - should restore from Hive
    await compiler.flush();

    expect(existsSync(catalogPath)).toBe(true);
    const restored = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(restored.title).toBe("تطبيق");
    expect(restored.description).toBeUndefined(); // Pruned because not in source HTML
    expect(restored.dir).toBe("rtl");
  });
});
