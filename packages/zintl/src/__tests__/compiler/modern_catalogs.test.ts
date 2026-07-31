import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext;

describe("ZintlCompiler - Modern Catalogs", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-modern-catalogs-");
  });

  it("should merge multiple locales into a single file in multilingual mode", async (context: LocalContext) => {
    const { root } = context;
    const compiler = createTestCompiler(
      {
        outputDir: "i18n",
        catalogFormat: "translations.json",
        locales: ["en", "ar", "es"],
      },
      root,
      true,
    );
    await compiler.setup();

    // Mock hive state
    (compiler as any).messages.hive = {
      ar: { "Hello World": "مرحبا بالعالم" },
      es: { "Hello World": "Hola Mundo" },
    };

    await compiler.transform(
      'import { t } from "zintljs"; t("Hello World")',
      join(root, "src/index.ts"),
    );
    await compiler.flush();

    const catalogPath = join(root, "i18n/translations.json");
    expect(existsSync(catalogPath)).toBe(true);
    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));

    expect(catalog["Hello World"]).toEqual({
      ar: "مرحبا بالعالم",
      es: "Hola Mundo",
    });

    // Verify schema is also multilingual
    const schemaPath = join(root, "i18n/.schemas/translations.shared.schema.json");
    expect(existsSync(schemaPath)).toBe(true);
    const schema = JSON.parse(await readFile(schemaPath, "utf-8"));
    expect(schema.properties["Hello World"].type).toBe("object");
    expect(schema.properties["Hello World"].properties.ar).toBeDefined();
    expect(schema.properties["Hello World"].properties.es).toBeDefined();
  });

  it("should prune orphaned files recursively when catalogFormat changes", async (context: LocalContext) => {
    const { root } = context;
    // 1. Setup with per-locale catalogs
    const compiler1 = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[path].[locale].json",
        locales: ["en", "ar"],
      },
      root,
      true,
    );
    await compiler1.setup();
    await compiler1.transform('import { t } from "zintljs"; t("A")', join(root, "src/page.ts"));
    await compiler1.flush();

    expect(existsSync(join(root, "locales/src/page.ar.json"))).toBe(true);
    // Sanity check: .schemas folder exists
    expect(existsSync(join(root, "locales/.schemas"))).toBe(true);

    // 2. Switch to single-file catalog
    const compiler2 = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "all.json",
        locales: ["en", "ar"],
      },
      root,
      true,
    );
    await compiler2.setup();
    await compiler2.transform('import { t } from "zintljs"; t("A")', join(root, "src/page.ts"));
    await compiler2.flush();

    // New files exist
    expect(existsSync(join(root, "locales/all.json"))).toBe(true);

    // Old files should be pruned
    expect(existsSync(join(root, "locales/src/page.ar.json"))).toBe(false);
    // Old schemas should be pruned
    expect(existsSync(join(root, "locales/.schemas/all.shared.schema.json"))).toBe(true); // New shared schema
  });

  it("should clean up old outputDir entirely when it is changed in config", async (context: LocalContext) => {
    const { root } = context;
    // 1. Setup with outputDir 'locales'
    const compiler1 = createTestCompiler(
      {
        outputDir: "locales",
        locales: ["en", "ar"],
      },
      root,
      true,
    );
    await compiler1.setup();
    await compiler1.transform('import { t } from "zintljs"; t("A")', join(root, "src/page.ts"));
    await compiler1.flush();

    expect(existsSync(join(root, "locales"))).toBe(true);

    // 2. Switch to outputDir 'i18n'
    const compiler2 = createTestCompiler(
      {
        outputDir: "i18n",
        locales: ["en", "ar"],
      },
      root,
      true,
    );

    // We need to simulate the persistent manifest by NOT deleting the root, but compiler1 already saved it.
    await compiler2.setup();
    await compiler2.transform('import { t } from "zintljs"; t("A")', join(root, "src/page.ts"));
    await compiler2.flush();

    // New directory exists
    expect(existsSync(join(root, "i18n"))).toBe(true);
    // OLD directory should be nuked
    expect(existsSync(join(root, "locales"))).toBe(false);
  });

  it("should be resilient to catalogFormat changes by falling back to Hive during build", async (context: LocalContext) => {
    const { root } = context;
    // 1. First run: Extract and flush in default format
    const compiler1 = createTestCompiler(
      {
        outputDir: "locales",
        locales: ["en", "ar"],
      },
      root,
      false, // Production mode to test cached behavior
    );
    await compiler1.setup();
    // Manually add translation to Hive and manifest
    (compiler1 as any).messages.hive = { ar: { Greeting: "مرحبا" } };
    (compiler1 as any).messages.markHiveDirty();
    await (compiler1 as any).messages.flushHive(); // Explicitly flush hive to disk for the next compiler to pick it up
    await compiler1.transform(
      'import { zintl, t } from "zintljs"; zintl(Math.random() > 0.5 ? "ar" : "en"); t("Greeting")',
      join(root, "src/index.ts"),
    );
    await compiler1.flush();

    expect(existsSync(join(root, "locales/src/index.ar.json"))).toBe(true);

    // 2. Second run: Change catalogFormat.
    // The physical files at the new paths DO NOT EXIST yet.
    const compiler2 = createTestCompiler(
      {
        outputDir: "locales",
        locales: ["en", "ar"],
        catalogFormat: "[locale]/[name].json", // Changed!
      },
      root,
      false, // Production mode
    );

    // Discovery phase happens during buildStart in Vite
    await compiler2.setup();
    await compiler2.discover();

    // Now, before flush() is called, Vite calls load() for virtual modules.
    // We expect generateVirtualModule to find the translation in the Hive.
    const safeId = (compiler2 as any).io.getSafeBoundaryId("src/index");
    const virtualId = `entry:${safeId}`;

    const { code } = await compiler2.generateVirtualModule(virtualId, "ar", true);

    expect(code).toContain('"مرحبا"');
  });
});
