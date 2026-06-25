import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Zintl Compiler - Directives Integration", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-directives-test-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    context.compiler = new ZintlCompiler(
      {
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true,
    );
  });

  it("should integrate @zintl-note into the JSON schema", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `
      export const App = () => (
        <div>
          {/* @zintl-note This is a test note */}
          <h1>Hello World</h1>
        </div>
      );
    `;
    const filePath = join(root, "src/App.tsx");
    await writeFile(filePath, code);

    await compiler.transform(code, filePath);
    await compiler.flush();

    const schemaPath = compiler.getSchemaPath("src/App.tsx:App");
    if (!schemaPath) throw new Error("Schema path not found");

    const schemaContent = await readFile(schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);

    expect(schema.properties["Hello World"]).toBeDefined();
    expect(schema.properties["Hello World"].description).toContain("Note: This is a test note");
  });

  it("should integrate @zintl-pass into the t() call and schema", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const code = `
      import { zintl } from "zintl";
      zintl("en");
      export const App = () => (
        <div>
          {/* @zintl-pass role="admin" status={user.active} */}
          <h1>Access Level</h1>
        </div>
      );
    `;
    const filePath = join(root, "src/App.tsx");
    await writeFile(filePath, code);

    const result = await compiler.transform(code, filePath);
    await compiler.flush();

    // 1. Check Schema
    const schemaPath = compiler.getSchemaPath("src/App.tsx:App");
    if (!schemaPath) throw new Error("Schema path not found");
    const schemaContent = await readFile(schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);

    expect(schema.properties["Access Level"].description).toContain("Variables: {role}, {status}");

    // 2. Check Transformation
    // It should contain something like _t("Access Level", { role: "admin", status: user.active }, ...)
    expect(result?.code).toContain('role: "admin"');
    expect(result?.code).toContain("status: user.active");
  });
});
