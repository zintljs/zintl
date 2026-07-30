import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintl/compiler";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

// ignore this test for now
describe("Zintl Compiler: Zero-Runtime Baking", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-zero-runtime-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    context.compiler = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
        catalogFormat: "[locale]/[path].json",
        logLevel: "silent",
      },
      root,
      false, // Production Mode (Baking Enabled)
    );
    await context.compiler.setup();
  });

  it("should bake manual t() calls into literal strings for static anchors", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `
      import { zintl, t } from "zintl";
      await zintl("ar");
      document.title = t("Welcome Page");
    `;
    const fullId = join(root, "src/main.ts");

    // Setup translation
    await mkdir(join(root, "locales/ar/src"), { recursive: true });
    await writeFile(
      join(root, "locales/ar/src/main.json"),
      JSON.stringify({ "Welcome Page": "صفحة الترحيب" }),
    );

    // First pass to discover and build catalogs
    await compiler.transform(code, fullId);
    await compiler.flush();

    // Second pass to apply baking
    const res = await compiler.transform(code, fullId);
    expect(res).toBeDefined();

    const output = res!.code;

    // Verification: Manual t() is baked
    expect(output).toMatch(/document\.title\s*=\s*[`'"]صفحة الترحيب[`'"]/);
    // Verification: Runtime loader is REMOVED (Zero-Runtime)
    expect(output).not.toContain("loadI18nInstance");
    expect(output).not.toContain("_t(");
    expect(output).not.toContain("virtual:zintl/manager");
  });

  it("should bake HTML sinks into literal Arabic strings and eliminate runtime", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `
      import { zintl } from "zintl";
      await zintl("ar");
      document.body.innerHTML = "Zintl is baked";
    `;
    const fullId = join(root, "src/sink.ts");

    // Setup translation
    await mkdir(join(root, "locales/ar/src"), { recursive: true });
    await writeFile(
      join(root, "locales/ar/src/sink.json"),
      JSON.stringify({ "Zintl is baked": "زينتل مخبوز" }),
    );

    await compiler.transform(code, fullId);
    await compiler.flush();

    const res = await compiler.transform(code, fullId);
    expect(res).toBeDefined();

    const output = res!.code;

    // Verification: Sink is baked
    expect(output).toMatch(/document\.body\.innerHTML\s*=\s*[`'"]زينتل مخبوز[`'"]/);
    // Verification: Zero-Runtime (no managers/loaders)
    expect(output).not.toContain("loadI18nInstance");
    expect(output).not.toContain("import { zintl } from");
  });

  it("should NOT eliminate runtime if the boundary has dynamic anchors", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `
      import { zintl, t } from "zintl";
      export async function init(lang) {
        await zintl(lang);
        return t("Hello");
      }
    `;
    const fullId = join(root, "src/dynamic.ts");

    await compiler.transform(code, fullId);
    await compiler.flush();

    const res = await compiler.transform(code, fullId);
    expect(res).toBeDefined();

    const output = res!.code;

    // Verification: Runtime is PRESERVED because anchor is dynamic
    expect(output).toContain("loadI18nInstance");
    expect(output).toContain("virtual:zintl/manager");
  });
});
