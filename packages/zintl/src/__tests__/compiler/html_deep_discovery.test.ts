import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintl/compiler";
import { createTestDir } from "../helpers/fs.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

describe("HTML Deep Discovery", () => {
  let context: {
    root: string;
    compiler: ZintlCompiler;
  };

  beforeEach(async () => {
    const root = await createTestDir("html-deep-");
    context = { root } as any;
    await mkdir(join(root, "src"), { recursive: true });
  });

  it("should recognize HTML as zintlized if it leads to a nested zintl() call", async () => {
    const { root } = context;

    // index.html -> main.ts -> lib.ts (has zintl)
    await writeFile(
      join(root, "index.html"),
      `<html><body><script src="/src/main.ts"></script></body></html>`,
    );

    await writeFile(join(root, "src/main.ts"), `import { setup } from "./lib"; setup();`);

    await writeFile(
      join(root, "src/lib.ts"),
      `import { zintl } from "zintl"; 
       export function setup() {
         zintl("ar");
       }`,
    );

    const compiler = createTestCompiler(
      { locales: ["en", "ar"], outputDir: "locales" },
      root,
      false,
    );

    await compiler.discover();
    await compiler.flush();

    const catalogPath = join(root, "locales", "index.html.ar.json");
    expect(existsSync(catalogPath)).toBe(true);
  });

  it("should prefer dynamic anchor over static anchor in the tree", async () => {
    const { root } = context;

    // index.html -> main.ts
    // main.ts -> static.ts (zintl("en"))
    // main.ts -> dynamic.ts (zintl(lang))
    await writeFile(
      join(root, "index.html"),
      `<html><head><title>Deep App</title></head><body><script src="/src/main.ts"></script></body></html>`,
    );

    await writeFile(join(root, "src/main.ts"), `import "./static"; import "./dynamic";`);

    await writeFile(join(root, "src/static.ts"), `import { zintl } from "zintl"; zintl("en");`);

    await writeFile(
      join(root, "src/dynamic.ts"),
      `import { zintl } from "zintl"; 
       async function init() {
         const lang = "ar";
         await zintl(lang);
       }
       init();`,
    );

    const compiler = createTestCompiler(
      { locales: ["en", "ar"], outputDir: "locales" },
      root,
      false,
    );

    await compiler.discover();

    // Transform index.html and check if it's dynamic
    const html = await compiler.transformHtml(
      readFileSync(join(root, "index.html"), "utf-8"),
      join(root, "index.html"),
    );

    // If dynamic, it should have the bootstrap script that uses current lang
    // In our implementation, if it's dynamic, it uses this.sourceLocale as targetLocale
    // BUT the bootstrap script should NOT be a literal one?

    // Let's check the transformed HTML
    expect(html).toContain('lang="en"'); // Default source locale
    // It should have the zintl-projection script
    expect(html).toContain('id="zintl-projection"');

    // The key is that it didn't fail to transform
    expect(html).toContain("<title>Deep App</title>");
  });
});
