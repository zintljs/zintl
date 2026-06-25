import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { join, dirname } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/**
 * Streaming & RSC Reference Suite
 *
 * Verifies "Literal Baking" on the server and the Handshake protocol
 * that prevents hydration flashes.
 */
describe("Macro Streaming: RSC Baking & Handshake", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-streaming-");
    context.root = root;
    context.compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"], outputDir: "locales" },
      root,
      false, // Production mode for baking logic
    );
    await context.compiler.setup();
    await mkdir(join(root, "src"), { recursive: true });
  });

  it("should bake literals in UI Sinks: <p>{'Welcome'}</p>", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    await mkdir(join(root, "src"), { recursive: true });

    const code = `import { zintl } from "zintl"; zintl("ar"); export function App() { return <p>{"Welcome"}</p>; }`;
    const filePath = join(root, "src/server.tsx");
    await writeFile(filePath, code);

    // Initial extraction
    await compiler.transform(code, filePath, "target");

    // Pre-seed translation to avoid integrity error
    const arPath = compiler.getCatalogPath("src/server.tsx:App", "ar")!;
    await mkdir(dirname(arPath), { recursive: true });
    await writeFile(arPath, JSON.stringify({ Welcome: "مرحباً" }));

    await compiler.flush();

    // Fill in translation
    const catalog = JSON.parse(await readFile(arPath, "utf-8"));
    catalog["Welcome"] = "مرحباً";
    await writeFile(arPath, JSON.stringify(catalog));

    await compiler.invalidateFile(arPath, true);
    // Add a trailing space to bypass hash cache for this test
    const result = await compiler.transform(code + " ", filePath, "target");

    // Now "مرحباً" should be baked into the output in RSC mode
    expect(result?.code).not.toContain("virtual:zintl/manager/ar/");
    expect(result?.code).not.toContain("loadI18nInstance");
    // expect(result?.code).toContain("Promise.resolve()");
    expect(result?.code).toContain("مرحباً");
    expect(result?.code).not.toContain('t("Welcome")');
  });

  it("should bake conditional logic: Count is {counter}", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `import { zintl } from "zintl"; zintl("ar"); export function Counter({ counter }) { return <div>{ "Count is {counter}" }</div>; }`;
    const filePath = join(root, "src/counter.tsx");
    await writeFile(filePath, code);

    await compiler.transform(code, filePath, "target");

    // Pre-seed translation to avoid integrity error
    const arPath = compiler.getCatalogPath("src/counter.tsx:Counter", "ar")!;
    await mkdir(dirname(arPath), { recursive: true });
    await writeFile(arPath, JSON.stringify({ "Count is {counter}": "placeholder" }));

    await compiler.flush();

    const catalog = JSON.parse(await readFile(arPath, "utf-8"));
    catalog["Count is {counter}"] = {
      "counter=1": "العدد واحد",
      "counter=0": "صفر",
      "counter>1": "العدد هو {counter}",
    };
    await writeFile(arPath, JSON.stringify(catalog));

    await compiler.invalidateFile(arPath, true);
    const result = await compiler.transform(code + " ", filePath, "target");

    // Verify handshake is gone (Zero-Runtime)
    expect(result?.code).not.toContain("loadI18nInstance");
    // expect(result?.code).toContain("Promise.resolve()");

    // Verify baked ternary tree
    expect(result?.code).toContain("counter == 1");
    expect(result?.code).toContain("العدد واحد");
    expect(result?.code).toContain("counter == 0");
    expect(result?.code).toContain("صفر");
    expect(result?.code).toContain("العدد هو ${counter}");
    expect(result?.code).not.toContain('t("Count is {counter}"');
  });

  it("should bake JSX elements correctly", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `import { zintl } from "zintl"; zintl("ar"); export function App() { return <button title="Click me">Submit</button>; }`;
    const filePath = join(root, "src/jsx.tsx");
    await writeFile(filePath, code);

    await compiler.transform(code, filePath, "target");

    // Pre-seed translation to avoid integrity error
    const arPath = compiler.getCatalogPath("src/jsx.tsx:App", "ar")!;
    await mkdir(dirname(arPath), { recursive: true });
    await writeFile(arPath, JSON.stringify({ Submit: "إرسال", "Click me": "انقر هنا" }));

    await compiler.flush();

    const catalog = JSON.parse(await readFile(arPath, "utf-8"));
    catalog["Submit"] = "إرسال!";
    catalog["Click me"] = "انقر هنا!";
    await writeFile(arPath, JSON.stringify(catalog));

    await compiler.invalidateFile(arPath, true);
    const result = await compiler.transform(code + " ", filePath, "target");

    // Verify handshake is gone (Zero-Runtime)
    expect(result?.code).not.toContain("loadI18nInstance");
    // expect(result?.code).toContain("Promise.resolve()");

    expect(result?.code).toContain("انقر هنا!");
    expect(result?.code).toContain("إرسال!");
    expect(result?.code).toContain("</button>");
  });

  // it("should fall back to empty string if translation is missing (Strict Mode)", async () => {
  //   const code = `import { zintl } from "zintl"; zintl("ar"); export function App() { return <p>{"Welcome"}</p>; }`;
  //   const filePath = join(root, "src/fallback.tsx");
  //   await writeFile(filePath, code);

  //   await compiler.transform(code, filePath, "target");
  //   await compiler.flush();

  //   const result = await compiler.transform(code + " ", filePath, "target");

  //   // Verify handshake
  //   expect(result?.code).toContain("loadI18nInstance");

  //   // Should bake an empty value (Note: if not tracked, it currently keeps same text if not in catalog)
  //   // expect(result?.code).toContain('""');
  //   expect(result?.code).toContain('{"Welcome"}');
  // });
});
