import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../../helpers/compiler.js";
import { ZintlCompiler } from "@zintl/compiler";
import { createTestDir, type TestContext } from "../../helpers/fs.js";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

type LocalContext = TestContext & { compiler: ZintlCompiler };

// TODO: Re-enable after fixing Reachability module
describe("ZRS §4.5 — Kingdom-Colony Reachability (The Bridge Pattern)", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-bridge-");
  });

  async function writeTestFile(root: string, path: string, content: string) {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  it("should extract translations through a pure logic bridge module", async (context: LocalContext) => {
    const { root } = context;

    await writeTestFile(
      root,
      "colony.ts",
      `
      import { t } from "zintl";
      export const getMessage = () => t("Hello from Colony");
    `,
    );

    await writeTestFile(
      root,
      "bridge.ts",
      `
      import { getMessage } from "./colony";
      export const bridgeFn = () => {
        return getMessage() + " (bridged)";
      };
    `,
    );

    await writeTestFile(
      root,
      "main.ts",
      `
      import { zintl } from "zintl";
      import { bridgeFn } from "./bridge";
      
      zintl(window.navigator.language);

      export async function run() {
        document.title = t("Main Page");
        console.log(bridgeFn());
      }
    `,
    );

    const compiler = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
        catalogFormat: "[locale]/[name].json",
      },
      root,
    );

    // Transform from leaf to root to test graph discovery
    await compiler.transform(
      await readFile(join(root, "colony.ts"), "utf-8"),
      join(root, "colony.ts"),
    );
    await compiler.transform(
      await readFile(join(root, "bridge.ts"), "utf-8"),
      join(root, "bridge.ts"),
    );
    await compiler.transform(await readFile(join(root, "main.ts"), "utf-8"), join(root, "main.ts"));

    await compiler.flush();

    // main should have the message
    const mainSchemaPath = join(root, "locales/.schemas/main.shared.schema.json");
    expect(existsSync(mainSchemaPath)).toBe(true);
    // catalog
    const mainCatalogPath = join(root, "locales/ar/main.json");
    expect(existsSync(mainCatalogPath)).toBe(true);
    const mainCatalog = JSON.parse(await readFile(mainCatalogPath, "utf-8"));
    expect(mainCatalog).toHaveProperty("Main Page");

    // colony should have the message
    const colonySchemaPath = join(root, "locales/.schemas/colony.schema.json");
    expect(existsSync(colonySchemaPath)).toBe(true);
    const colonyCatalogPath = join(root, "locales/ar/colony.json");
    expect(existsSync(colonyCatalogPath)).toBe(true);
    const colonyCatalog = JSON.parse(await readFile(colonyCatalogPath, "utf-8"));
    expect(colonyCatalog).toHaveProperty("Hello from Colony");

    // bridge should not have the message
    const bridgeSchemaPath = join(root, "locales/.schemas/bridge.schema.json");
    expect(existsSync(bridgeSchemaPath)).toBe(false);
    const bridgeCatalogPath = join(root, "locales/ar/bridge.json");
    expect(existsSync(bridgeCatalogPath)).toBe(false);
  });

  it("should isolate translations if the bridge is broken by a nested anchor", async (context: LocalContext) => {
    const { root } = context;

    await writeTestFile(
      root,
      "colony.ts",
      `
      import { t } from "zintl";
      export const getMessage = () => t("Colony Message");
    `,
    );

    await writeTestFile(
      root,
      "bridge.ts",
      `
      import { zintl } from "zintl";
      import { getMessage } from "./colony";
      
      zintl("ar");
      export const bridgeFn = async () => {
        return getMessage();
      };
    `,
    );

    await writeTestFile(
      root,
      "main.ts",
      `
      import { zintl, t } from "zintl";
      import { bridgeFn } from "./bridge";
      
      zintl(window.navigator.language);
      export async function run() {
      document.title = t("Main Page");
        return await bridgeFn();
      }
    `,
    );

    const compiler = createTestCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
        catalogFormat: "[locale]/[name].json",
      },
      root,
    );

    await compiler.transform(
      await readFile(join(root, "colony.ts"), "utf-8"),
      join(root, "colony.ts"),
    );
    await compiler.transform(
      await readFile(join(root, "bridge.ts"), "utf-8"),
      join(root, "bridge.ts"),
    );
    await compiler.transform(await readFile(join(root, "main.ts"), "utf-8"), join(root, "main.ts"));
    await compiler.flush();

    // main.ts should NOT have the message because bridge.ts is a "Trusted Anchor"
    const mainSchemaPath = join(root, "locales/.schemas/main.shared.schema.json");
    expect(existsSync(mainSchemaPath)).toBe(true);
    const mainCatalogPath = join(root, "locales/ar/main.json");
    expect(existsSync(mainCatalogPath)).toBe(true);
    const mainCatalog = JSON.parse(await readFile(mainCatalogPath, "utf-8"));
    expect(mainCatalog).toHaveProperty("Main Page");

    //colony.ts should have the message
    const colonySchemaPath = join(root, "locales/.schemas/colony.schema.json");
    expect(existsSync(colonySchemaPath)).toBe(true);
    const colonyCatalogPath = join(root, "locales/ar/colony.json");
    expect(existsSync(colonyCatalogPath)).toBe(true);
    const colonyCatalog = JSON.parse(await readFile(colonyCatalogPath, "utf-8"));
    expect(colonyCatalog).toHaveProperty("Colony Message");

    //  bridge.ts should have no messages and no schema file, since it does not have any messages, however, it should has the virtual catalog as colony should have the translated messages.
    const bridgeSchemaPath = join(root, "locales/.schemas/bridge.schema.json");
    expect(existsSync(bridgeSchemaPath)).toBe(false);
    const bridgeCatalogPath = join(root, "locales/ar/bridge.json");
    expect(existsSync(bridgeCatalogPath)).toBe(false);
  });
});
