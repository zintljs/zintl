import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/**
 * Ledger L-057. On a host that is *told* what to invalidate rather than asked,
 * a generated module that declares the wrong inputs is never rebuilt — and the
 * page then renders new source against an old catalog, which with no
 * source-locale fallback is a blank element that nothing repairs.
 *
 * Both halves of the bug were invisible to a build: the output was correct, it
 * simply arrived one edit late.
 */
describe("declared boundary inputs (L-057)", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("boundary-inputs-");
    context.root = root;
    await mkdir(join(root, "src/pages"), { recursive: true });

    await writeFile(
      join(root, "src/index.ts"),
      `import { zintl } from "zintljs";\nimport { Home } from "./pages/Home.ts";\n` +
        `async function render() { await zintl("en"); document.body.append(Home()); }\nvoid render();\n`,
    );
    await writeFile(
      join(root, "src/pages/Home.ts"),
      `export function Home() {\n  const el = document.createElement("div");\n` +
        `  el.innerHTML = \`<h1>Vanilla Rsbuild</h1>\`;\n  return el;\n}\n`,
    );

    /**
     * `getBoundaryInputs` is asserted directly rather than through a host.
     * Whether a host *consumes* the answer is gated on `dependencyInvalidation`
     * (Rspack), but the answer itself is host-neutral — and it was the answer
     * that was wrong.
     */
    context.compiler = createTestCompiler(
      { sourceLocale: "en", locales: ["en", "ar"], outputDir: "locales" },
      root,
      true, // isDev
    );
  });

  it("names a catalog path that can exist", async (context: LocalContext) => {
    const { compiler } = context as { compiler: ZintlCompiler };
    await compiler.setup();
    await compiler.discover();

    const boundary = Object.keys(compiler.messages.internalManifest).find((b) =>
      b.includes("Home"),
    );
    expect(boundary).toBeDefined();

    const inputs = compiler.getBoundaryInputs(compiler.io.getSafeBoundaryId(boundary!));

    /**
     * The defect: a **safe** id (`b_src_pages_Home_Home`) reaching
     * `getCatalogPath`, which reads its argument as `<path>:<func>` — so it
     * produced `locales/b_src_pages_Home_Home.ar.json`, a file no flush will
     * ever write. Rspack accepted the dependency, found nothing, and the
     * generated module stayed fresh forever.
     */
    expect(inputs.some((p) => p.includes("b_src_pages_Home_Home."))).toBe(false);
    expect(inputs.some((p) => p.endsWith(join("locales", "src/pages/Home.Home.ar.json")))).toBe(
      true,
    );
    // And the boundary's own source, which is what an edit actually touches.
    expect(inputs.some((p) => p.endsWith(join("src", "pages", "Home.ts")))).toBe(true);
  });

  it("covers every boundary asked about, not just the first", async (context: LocalContext) => {
    const { compiler } = context as { compiler: ZintlCompiler };
    await compiler.setup();
    await compiler.discover();

    const boundaries = Object.keys(compiler.messages.internalManifest);
    const safe = boundaries.map((b) => compiler.io.getSafeBoundaryId(b));

    const union = compiler.getBoundaryInputs(safe);
    for (const one of safe) {
      for (const input of compiler.getBoundaryInputs(one)) {
        expect(union).toContain(input);
      }
    }
  });
});
