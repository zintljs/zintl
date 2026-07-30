import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { join } from "node:path";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext;

describe("HTML Catalog Isolation & Persistence", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-html-isolation-");
    await mkdir(join(context.root, "src"), { recursive: true });
  });

  it("should isolate HTML catalogs even when a shared catalogFormat is used", async (context: LocalContext) => {
    const { root } = context;
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        catalogFormat: "shared.json", // This would normally group everything
        locales: ["en", "ar"],
      },
      root,
      true, // Dev mode
    );
    await compiler.setup();

    // 1. Create an HTML file with projection
    const htmlCode = `<html><head><title>My App</title></head><body><script src="/src/main.ts"></script></body></html>`;
    const htmlPath = join(root, "index.html");
    await writeFile(htmlPath, htmlCode);

    // 2. Create a TS file with messages
    const tsCode = `import { zintl } from "zintl"; zintl("en"); document.body.innerHTML = "Hello";`;
    const tsPath = join(root, "src/main.ts");
    await writeFile(tsPath, tsCode);

    // 3. Transform both
    await compiler.transform(htmlCode, htmlPath);
    await compiler.transform(tsCode, tsPath);

    // Apply HTML transformation (which requires metadata from previous step)
    await compiler.transformHtml(htmlCode, htmlPath);
    await compiler.flush();

    // 4. Verify isolation
    const sharedPath = join(root, "locales/shared.json");
    const htmlArPath = join(root, "locales/index.html.shared.json");

    // Shared catalog should exist and contain the TS message
    expect(existsSync(sharedPath)).toBe(true);
    const sharedContent = JSON.parse(await readFile(sharedPath, "utf-8"));
    expect(sharedContent["Hello"]).toBeDefined();
    expect(sharedContent["title"]).toBeUndefined(); // Should NOT be in shared

    // HTML catalog should exist and contain the metadata
    expect(existsSync(htmlArPath)).toBe(true);
    const htmlContent = JSON.parse(await readFile(htmlArPath, "utf-8"));
    expect(htmlContent["title"]).toEqual({ ar: "" });
    expect(htmlContent["dir"]).toEqual({ ar: "" });
    expect(htmlContent["Hello"]).toBeUndefined(); // Should NOT be in HTML catalog
  });

  it("should not remove HTML catalogs in dev mode even if they have no JS messages", async (context: LocalContext) => {
    const { root } = context;
    const compiler = createTestCompiler(
      {
        outputDir: "locales",
        locales: ["en", "ar"],
      },
      root,
      true, // Dev mode
    );
    await compiler.setup();

    // 1. HTML file with projection but NO JS messages
    const htmlCode = `<html><head><title>Static Page</title><script src="/src/main.ts"></script></head><body></body></html>`;
    const htmlPath = join(root, "index.html");
    await writeFile(htmlPath, htmlCode);

    const tsCode = `import { zintl } from "zintl"; zintl("en");`;
    const tsPath = join(root, "src/main.ts");
    await writeFile(tsPath, tsCode);

    await compiler.transform(htmlCode, htmlPath);
    await compiler.transform(tsCode, tsPath);
    await compiler.transformHtml(htmlCode, htmlPath);
    await compiler.flush();

    const htmlArPath = join(root, "locales/index.html.ar.json"); // default format is used here
    expect(existsSync(htmlArPath)).toBe(true);

    // 2. Run flush again (simulate another change) - should still be there
    await compiler.flush();
    expect(existsSync(htmlArPath)).toBe(true);
  });
});
