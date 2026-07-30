import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintl/compiler";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("HTML Observation", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("html-observation-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
  });

  it("should discover and observe HTML files", async (context: LocalContext) => {
    const { root } = context;
    const htmlCode = `
      <html>
      <head>
        <title>Discovery Test</title>
        <script type="module" src="/src/main.ts"></script>
      </head>
      </html>
    `;
    await writeFile(join(root, "index.html"), htmlCode);

    const compiler = createTestCompiler({}, root, true);
    await compiler.setup();
    await compiler.discover();

    const metadata = compiler.metadataGraph["index.html"];
    expect(metadata).toBeDefined();
    expect(metadata.htmlProjection).toBeDefined();
    expect(metadata.htmlProjection?.title).toBe("Discovery Test");
    expect(metadata.htmlProjection?.scripts).toContain("/src/main.ts");
  });
});
