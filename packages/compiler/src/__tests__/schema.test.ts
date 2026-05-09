import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { readFile } from "node:fs/promises";
import { createTestDir } from "./helpers/fs.js";

type LocalContext = {
  compiler: ZintlCompiler;
};

describe("Zintl Compiler - Schema Generation", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-schema-test-");
    context.compiler = new ZintlCompiler(
      {
        locales: ["en", "es"],
      },
      root,
      true,
    );
  });

  it("should generate schema with notes and variables", async ({ compiler }: LocalContext) => {
    const boundaryId = "src/Banner";
    const messages: any[] = [
      { text: "Welcome, {name}!", variables: ["name"], note: "User greeting" },
      { text: "Log out", variables: [], note: "" },
    ];

    const schemaPath = compiler.getSchemaPath(boundaryId);
    if (!schemaPath) throw new Error("Schema path not found");

    await (compiler as any).safeGenerateSchema(schemaPath, messages);

    const schemaContent = await readFile(schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);

    expect(schema.properties["Welcome, {name}!"]).toBeDefined();
    expect(schema.properties["Welcome, {name}!"].description).toContain(
      "Note: User greeting | Variables: {name}",
    );
    expect(schema.properties["Welcome, {name}!"].anyOf).toBeDefined(); // Objects supported for variables

    expect(schema.properties["Log out"]).toBeDefined();
    expect(schema.properties["Log out"].type).toBe("string");
  });

  it("should ensure schema reference is at the top of the catalog", ({
    compiler,
  }: LocalContext) => {
    const userCatalog = { key: "value" };
    const schemaPath = "/root/locales/.schemas/Banner.schema.json";
    const catalogPath = "/root/locales/es/Banner.json";

    const final = (compiler as any).ensureSchemaAtTop(userCatalog, schemaPath, catalogPath);

    const keys = Object.keys(final);
    expect(keys[0]).toBe("$schema");
    expect(final.$schema).toBe("../.schemas/Banner.schema.json");
    expect(final.key).toBe("value");
  });
});
