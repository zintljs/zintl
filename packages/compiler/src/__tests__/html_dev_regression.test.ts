import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("HTML Dev Mode Persistence Regression", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("html-dev-regression-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    // Simulate Dev Mode
    context.compiler = new ZintlCompiler(
      {
        locales: ["en", "ar"],
        outputDir: "locales",
        catalogFormat: "[locale]/[name].json",
        prune: true,
      },
      root,
      true, // isDev = true
    );
  });

  it("should NOT remove HTML catalogs in dev mode even if they have no JS keys", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    // 1. Create an HTML file with metadata but NO zintl() calls in JS
    const htmlCode = `
      <html>
      <head>
        <title>Persistence Test</title>
        <script type="module" src="/src/main.ts"></script>
      </head>
      <body></body>
      </html>
    `;
    await writeFile(join(root, "index.html"), htmlCode);

    // src/main.ts has NO translations
    const mainCode = `
      console.log("No zintl here");
      document.body.innerHTML = "<h1>Welcome to Zintl</h1>";
    `;
    await writeFile(join(root, "src/main.ts"), mainCode);

    await compiler.setup();
    await compiler.discover();

    // 2. First flush should NOT generate the catalog because main.ts is not zintlized
    await compiler.flush();

    const catalogPath = join(root, "locales", "ar/index.html.json");
    expect(existsSync(catalogPath)).toBe(false);

    // 3. Update main.ts to be zintlized with a dynamic anchor
    const zintlizedMain = `
      import { zintl } from "zintl";
      const l = new URLSearchParams(window.location.search).get("lang") || "en";
      zintl(l);
      document.body.innerHTML = "<h1>Welcome to Zintl</h1>";
    `;
    await writeFile(join(root, "src/main.ts"), zintlizedMain);
    await compiler.discover();
    await compiler.flush();

    // Now it should exist
    expect(existsSync(catalogPath)).toBe(true);

    // 4. Update main.ts to remove zintl and flush again
    await writeFile(join(root, "src/main.ts"), "console.log('no more zintl');");
    await compiler.discover();
    await compiler.flush();

    // It should be pruned
    expect(existsSync(catalogPath)).toBe(false);
  });
});
