import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("HTML Dev Mode Transformation", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("html-dev-transformation-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/main.ts"), 'import { zintl } from "zintl"; zintl("en");');
    context.compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar", "es"], outputDir: "locales" },
      root,
      true, // isDev
    );
  });

  it("should bake localized values for static literal anchor ($A_static)", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    // 1. Create a script with a literal anchor
    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl("ar");`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    // 2. Create HTML referencing the script
    const htmlCode = `
      <html>
      <head>
        <title>Original Title</title>
        <meta name="description" content="Original Desc">
        <script type="module" src="/src/main.ts"></script>
      </head>
      <body></body>
      </html>
    `;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();

    // 3. Create a localized catalog for 'ar'
    await mkdir(join(root, "locales"), { recursive: true });
    await compiler.discover();
    await compiler.flush();

    await writeFile(
      join(root, "locales/index.html.ar.json"),
      JSON.stringify({
        title: "Arabic Title",
        description: "Arabic Desc",
        dir: "rtl",
      }),
    );

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    expect(transformed).toContain('dir="rtl"');
    expect(transformed).toContain("<title>Arabic Title</title>");
    expect(transformed).toContain('<meta name="description" content="Arabic Desc">');
  });

  it("should inject bootstrap script for dynamic expression anchor ($A_dynamic)", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    // 1. Create a script with an expression anchor
    const scriptCode = `import { zintl } from "@zintl/runtime"; const l = "ar"; zintl(l);`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    // 2. Create HTML
    const htmlCode = `
      <html>
      <head>
        <title>Test</title>
        <script type="module" src="/src/main.ts"></script>
      </head>
      </html>
    `;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();

    await compiler.discover();
    await compiler.flush();

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));

    expect(transformed).toContain("localStorage.getItem('zintl-locale')");
    expect(transformed).toContain("document.documentElement.lang = locale;");
  });

  it("should not use dir='rtl' from source HTML if dir is not present in locale JSON, default to empty string", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    // 1. Create a script with a literal anchor
    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl("es");`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    // 2. Create HTML referencing the script with dir="rtl"
    const htmlCode = `
      <html dir="rtl">
      <head>
        <title>Original Title</title>
        <script type="module" src="/src/main.ts"></script>
      </head>
      <body></body>
      </html>
    `;
    await writeFile(join(root, "index.html"), htmlCode);

    await mkdir(join(root, "locales"), { recursive: true });
    await writeFile(
      join(root, "locales/index.html.es.json"),
      JSON.stringify({
        dir: "",
        title: "Spanish Title",
      }),
    );

    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    // Transform for 'es'
    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    // if empty we do not set dir
    expect(transformed).not.toContain("dir");
    expect(transformed).toContain("Spanish Title");
  });

  it("should use dir from catalog even if it differs from source HTML", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl("ar");`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    const htmlCode = `<html dir="rtl"><head><script type="module" src="/src/main.ts"></script></head></html>`;
    await writeFile(join(root, "index.html"), htmlCode);

    await mkdir(join(root, "locales"), { recursive: true });
    await writeFile(
      join(root, "locales/index.html.ar.json"),
      JSON.stringify({
        dir: "ltr",
      }),
    );

    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    expect(transformed).toContain('dir="ltr"');
    expect(transformed).not.toContain('dir="rtl"');
  });
});

describe("HTML Production Mode Transformation", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("html-prod-transformation-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    context.compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"], outputDir: "locales" },
      root,
      false, // isDev (Production)
    );
  });

  it("should still inject bootstrap script for dynamic anchor in Production", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const scriptCode = `import { zintl } from "@zintl/runtime"; const l = window.lang; zintl(l);`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    const htmlCode = `<html><head><title>Prod</title><script type="module" src="/src/main.ts"></script></head></html>`;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();

    await compiler.discover();
    await compiler.flush();

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    expect(transformed).toContain("window.__zintlApplyHtml = apply;");
    // Even if dynamic, we should at least have the source lang on the html tag for the initial shell
    expect(transformed).toContain('lang="en"');
  });

  it("should apply source locale metadata projection even for dynamic anchors", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl(window.lang);`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    const htmlCode = `<html><head><title>Original</title><script type="module" src="/src/main.ts"></script></head></html>`;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();

    await compiler.discover();
    await compiler.flush();

    // Create Arabic catalog
    await mkdir(join(root, "locales"), { recursive: true });
    await compiler.discover();
    await compiler.flush();

    await writeFile(
      join(root, "locales/index.html.ar.json"),
      JSON.stringify({
        title: "Arabic Title",
        dir: "rtl",
      }),
    );

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    expect(transformed).not.toContain('dir="ltr"');
    expect(transformed).toContain(`const rtl = ["ar"];`);
    expect(transformed).toContain(`const deltas = {"ar":{"title":"Arabic Title"}};`);
    expect(transformed).toContain(`window.__zintlApplyHtml = apply;`);
  });

  it("should respect custom source locale in bootstrap script", async (context: LocalContext) => {
    const { root } = context;
    const compiler = new ZintlCompiler(
      { sourceLocale: "es", locales: ["es", "en"], outputDir: "locales" },
      root!,
      false, // Production
    );

    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl(window.lang);`;
    await writeFile(join(root!, "src/main.ts"), scriptCode);

    const htmlCode = `<html><head><script type="module" src="/src/main.ts"></script></head></html>`;
    await writeFile(join(root!, "index.html"), htmlCode);
    await compiler.setup();

    await compiler.discover();
    await compiler.flush();

    const transformed = await compiler.transformHtml(htmlCode, join(root!, "index.html"));
    expect(transformed).toContain(`const l = localStorage.getItem('zintl-locale') || 'es';`);
    expect(transformed).toContain(`        if (l !== 'es') {\n          apply(l);`);
    expect(transformed).toContain('lang="es"');
  });

  it("should bake localized values for literal anchor in Production", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl("ar");`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    const htmlCode = `<html><head><title>Original</title><script type="module" src="/src/main.ts"></script></head></html>`;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();

    // Create Arabic catalog
    await mkdir(join(root, "locales"), { recursive: true });
    await compiler.discover();
    await compiler.flush();

    await writeFile(
      join(root, "locales/index.html.ar.json"),
      JSON.stringify({
        title: "Arabic Title",
        dir: "rtl",
      }),
    );

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    expect(transformed).toContain('lang="ar"');
    expect(transformed).toContain('dir="rtl"');
    expect(transformed).toContain("<title>Arabic Title</title>");
  });

  it("should translate generic body text and attributes in literal mode", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl("ar");`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    const htmlCode = `<html><head><script type="module" src="/src/main.ts"></script></head><body><h1>Hello World</h1><input placeholder="Search..."></body></html>`;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();

    // Create Arabic catalog
    await mkdir(join(root, "locales"), { recursive: true });
    await compiler.discover();
    await compiler.flush();

    await writeFile(
      join(root, "locales/index.html.ar.json"),
      JSON.stringify({
        "Hello World": "مرحبا بالعالم",
        "Search...": "بحث...",
        dir: "rtl",
      }),
    );

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    expect(transformed).toContain("<h1>مرحبا بالعالم</h1>");
    expect(transformed).toContain('placeholder="بحث..."');
  });

  it("should tag and generate delta maps for body text and attributes in dynamic mode", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const scriptCode = `import { zintl } from "@zintl/runtime"; zintl(window.lang);`;
    await writeFile(join(root, "src/main.ts"), scriptCode);

    const htmlCode = `<html><head><script type="module" src="/src/main.ts"></script></head><body><h1>Hello World</h1><input placeholder="Search..."></body></html>`;
    await writeFile(join(root, "index.html"), htmlCode);
    await compiler.setup();

    // Create Arabic catalog
    await mkdir(join(root, "locales"), { recursive: true });
    await compiler.discover();
    await compiler.flush();

    await writeFile(
      join(root, "locales/index.html.ar.json"),
      JSON.stringify({
        "Hello World": "مرحبا بالعالم",
        "Search...": "بحث...",
        dir: "rtl",
      }),
    );

    const transformed = await compiler.transformHtml(htmlCode, join(root, "index.html"));
    expect(transformed).toContain('<h1 data-zintl-id="z_0">Hello World</h1>');
    expect(transformed).toContain('<input data-zintl-id="z_1" placeholder="Search...">');
    expect(transformed).toContain('"z_0":{"type":"text","name":"","val":"مرحبا بالعالم"}');
    expect(transformed).toContain('"z_1":{"type":"attr","name":"placeholder","val":"بحث..."}');
    expect(transformed).toContain('"z_0":{"type":"text","name":"","val":"Hello World"}');
  });
});
