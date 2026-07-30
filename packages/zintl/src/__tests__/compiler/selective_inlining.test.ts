// oxlint-disable typescript/no-implied-eval
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintl/compiler";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

function evalManager(code: string) {
  const objectPart = code
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n")
    .replace(/^export default /, "")
    // Mock import() for Node evaluation
    .replace(/import\(/g, "Promise.resolve(")
    .trim()
    .replace(/;$/, "");
  return new Function(`return (${objectPart})`)();
}

describe("Zintl Compiler: Selective Inlining", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-inlining-tests-");
    context.compiler = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      context.root,
      false, // Production mode for selective inlining tests
    );
    await context.compiler.setup();
  });

  it("should inline ONLY the anchor locale for zintl('ar')", async (context: LocalContext) => {
    const { compiler, root } = context as { compiler: ZintlCompiler; root: string };
    const code = `import { t, zintl } from "zintl"; zintl("ar");\nconsole.log(t("Arabic Content"));`;
    const fullId = join(root, "src/main.ts");

    // Process the file
    const res = await compiler.transform(code, fullId, "virtual:zintl/catalogs");
    await compiler.flush();
    expect(res).toBeDefined();

    const inlinedCode = res!.code;
    // Verification 1: In production with literal locale, it MUST be baked (Zero-Runtime)
    // expect(inlinedCode).toContain("Promise.resolve()");
    expect(inlinedCode).toContain("Arabic Content");

    // Verification 2: The Manager Logic from the virtual module
    const moduleId = "entry:src/main";
    const mod = await compiler.generateVirtualModule(moduleId, "ar", true);

    // Evaluate the manager (accessed directly as a function)
    const manager = evalManager(mod.code);

    // 1. Sync locale (ar) should be an OBJECT (inlined)
    const arResult = manager.loader("ar")[compiler.getSafeBoundaryId("src/main")];
    expect(typeof arResult).toBe("object");
    expect(arResult && typeof arResult.then !== "function").toBe(true);
    expect(Object.keys(arResult).length).toBe(1);

    // 2. Other locales should also return the object (unreachable but safe)
    const enResult = manager.loader("en");
    expect(typeof enResult).toBe("object");
    expect(enResult && typeof enResult.then !== "function").toBe(true);
  });

  it("should NOT inline ANY locale for dynamic zintl(lang)", async (context: LocalContext) => {
    const { compiler, root } = context as { compiler: ZintlCompiler; root: string };
    const code = `import { zintl } from "zintl"; zintl(1 + 1 === 2 ? "ar" : "en");\ndocument.body.innerHTML = "Dynamic Content";`;
    const fullId = join(root, "src/dynamic.ts");

    await compiler.transform(code, fullId, "virtual:zintl/catalogs");
    const mod = await compiler.generateVirtualModule("entry:src/dynamic", "en", true);
    const manager = evalManager(mod.code);

    // When the anchor is dynamic, the source locale (en) is INLINED
    const enResult = manager.loader("en")[compiler.getSafeBoundaryId("src/dynamic")];
    expect(typeof enResult).toBe("object");
    expect(enResult && typeof enResult.then !== "function").toBe(true);

    // Other locales are lazy
    const arResult = manager.loader("ar");
    expect(arResult && typeof arResult.then === "function").toBe(true);
  });

  it("should downgrade to dynamic mode if ANY anchor is dynamic (Mixed Scenario)", async (context: LocalContext) => {
    const { compiler, root } = context as { compiler: ZintlCompiler; root: string };
    // Top-level is static ("en"), but nested is dynamic (lang variable)
    const code = `
      import { zintl } from "zintl";
      await zintl("en");
      export async function render(lang) {
        await zintl(lang);
        return t("Hello");
      }
    `;
    const fullId = join(root, "src/mixed.ts");

    const res = await compiler.transform(code, fullId, "virtual:zintl/catalogs");
    expect(res).toBeDefined();

    // Verify: The manager should have syncLocale "none" because it was downgraded
    const inlinedCode = res!.code;
    expect(inlinedCode).toContain("virtual:zintl/manager/none/entry:");

    // Check that __ZINTL_LOCALE__ was NOT injected (since it was downgraded)
    expect(inlinedCode).not.toContain("__ZINTL_LOCALE__");
  });
});
