import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Zintl Compiler: Orphaned Files", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-orphaned-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    context.compiler = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true,
    );
    await context.compiler.setup();
  });

  it("should NOT transform a file that has no directive and is NOT reachable from an entry point", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const orphanedCode = `const msg = "Orphaned Message";`;
    const result = await compiler.transform(
      orphanedCode,
      join(root, "src/orphaned.ts"),
      "virtual:zintl/catalogs",
    );

    // Result should be undefined (no transformation)
    expect(result).toBeUndefined();
  });

  it("should transform a file even if it NOT yet reachable from an entry point (Autonomous Handshake)", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const reachableCode = `document.body.innerHTML = "Reachable Message";`;

    // 1. Transform reachable file first
    const r1 = await compiler.transform(
      reachableCode,
      join(root, "src/reachable.ts"),
      "virtual:zintl/catalogs",
    );
    expect(r1!.code).toContain(
      't("Reachable Message", { _mgr: _zintl_mgr_b_src_reachable, _bId: "b_src_reachable" })',
    );
  });

  it("should transform a file if it has the 'use i18n' directive even if not reachable", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const directiveCode = `import { zintl } from "zintl"; zintl("en");\ndocument.body.innerHTML = "Directive Message";`;
    const result = await compiler.transform(
      directiveCode,
      join(root, "src/directive.ts"),
      "virtual:zintl/catalogs",
    );

    expect(result).toBeDefined();
    expect(result!.code).toContain(
      't("Directive Message", { _mgr: _zintl_mgr_b_src_directive, _bId: "b_src_directive" })',
    );
  });

  it("should NOT transform a file with UI sinks if the project has zero zintl anchors/entries", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const examplePath = join(root, "examples/my-app/src/counter.ts");
    const code = `export function setup(element: HTMLElement) { element.innerHTML = "Count is 0"; }`;

    const result = await compiler.transform(code, examplePath, "virtual:zintl/catalogs");

    expect(result).toBeUndefined();
  });
});
