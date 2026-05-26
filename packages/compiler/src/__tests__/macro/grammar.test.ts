import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/**
 * Zintl Macro Grammar Reference Suite
 *
 * Verifies that the compiler transforms zintl() calls into the correct
 * runtime loading patterns based on the provided arguments.
 */
describe("Macro Grammar: AST Rewrites", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-grammar-");
    context.root = root;
    context.compiler = new ZintlCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true,
    );
  });

  it("should transform static absolute anchor: zintl('ar')", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `import { zintl } from "zintl"; zintl("ar"); document.body.innerHTML = "Welcome";`;
    const result = await compiler!.transform(code, join(root, "src/static.ts"), "target");

    // In Dev Mode: Readable path for _bId and URL, hash for JS variable
    expect(result?.code).toContain(
      'import _zintl_mgr_b_src_static from "virtual:zintl/manager/ar/entry:b_src_static"',
    );
    expect(result?.code).toContain(
      'loadI18nInstance({ locale: "ar", loaders: { ["b_src_static"]: _zintl_mgr_b_src_static.loader } })',
    );
    expect(result?.code).toContain(
      't("Welcome", { _mgr: _zintl_mgr_b_src_static, _bId: "b_src_static" })',
    );
  });

  it("should transform implicit contextual anchor: zintl()", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `import { zintl } from "zintl"; zintl(); document.body.innerHTML = "Welcome";`;
    const result = await compiler!.transform(code, join(root, "src/implicit.ts"), "target");

    // Should have self-registration loaders with hashed safeIds
    expect(result?.code).toContain(
      'loadI18nInstance({ loaders: { ["b_src_implicit"]: _zintl_mgr_b_src_implicit.loader } })',
    );
    expect(result?.code).not.toContain('locale: "');
  });

  it("should handle extraction markers: import 'zintl'", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `import "zintl"; document.body.innerHTML = "Welcome";`;
    const result = await compiler!.transform(code, join(root, "src/marker.ts"), "target");

    // Marker promotes to Entry. Even if no strings, it gets a handshake for potential reachable content.
    expect(result?.code).toContain("import _zintl_mgr_b_src_marker");
    expect(result?.code).toContain("loadI18nInstance");
    await compiler!.flush();

    // Verify it was identified as an entry
    expect(compiler!.isEntry("src/marker")).toBe(true);

    // Verify it was extracted (though no messages since "msg" is not a sink)
    const messages = compiler!.getMessages("src/marker");
    expect(messages).toBeDefined();
  });

  it("should bake template literal fragments without redundant backticks", async (context: LocalContext) => {
    const { root } = context as { root: string };
    // 1. Setup compiler for baking (prod mode)
    const prodCompiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // prod mode enables baking
    );

    const bId = "src/tmpl";
    const code = `import { zintl } from "zintl"; zintl("en"); document.body.innerHTML = \`<p>Test \${test.sss}</p>\`;`;

    // Manual setup of manifest to trigger baking for a specific ID
    const filePath = join(root, "src/tmpl.ts");

    // Trigger transform to extract
    await prodCompiler.transform(code, filePath, "target");

    // Verify it was extracted
    const messages = prodCompiler.getMessages(bId);
    expect(messages.length).toBe(1);

    // We need to flush or manually populate internalManifest for getCatalogForFullModule
    await prodCompiler.flush();

    const result = await prodCompiler.transform(code, filePath, "target");

    // Expect: <p>Test ${test.sss}</p>
    // NOT: <p>`Test ${test.sss}`</p>
    // Note: In Salvation 4.5, if it's baked, the t() call is gone.
    expect(result?.code).toContain("<p>Test ${test.sss}</p>");
  });
});
