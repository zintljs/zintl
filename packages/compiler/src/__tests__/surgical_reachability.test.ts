import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { createTestDir } from "./helpers/fs.js";

type TestContext = {
  root?: string;
};

describe("Surgical Reachability", () => {
  beforeEach(async (context: TestContext) => {
    const root = await createTestDir("zintl-surgical-test-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
  });

  it("should exclude unused top-level strings from entry catalogs", async (context: TestContext) => {
    const root = context.root!;
    // 1. Dependency file with top-level string and an exported function
    const counterTs = `
      import { t } from "zintl";
      export const x = t("Hello Top Level");
      export function setupCounter() {
        return t("Inside Function");
      }
    `;
    await writeFile(join(root, "src/counter.ts"), counterTs);

    // 2. Entry file that ONLY uses the exported function
    const mainTs = `
      import { zintl } from "zintl";
      import { setupCounter } from "./counter";

      async function render() {
        await zintl("ar");
        setupCounter();
      }
    `;
    await writeFile(join(root, "src/main.ts"), mainTs);

    const compiler = new ZintlCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true,
    );

    // 3. Transform both
    await compiler.transform(counterTs, join(root, "src/counter.ts"), "src/counter.ts");
    await compiler.transform(mainTs, join(root, "src/main.ts"), "src/main.ts");

    // 4. Build graphs
    const state = await compiler.getDiagnosticWorldState();

    // 5. Verify Boundary Graph Nodes
    const nodes = Array.from(state.boundaryGraph.nodes.keys());
    expect(nodes).toContain("src/main:render");
    expect(nodes).toContain("src/counter:setupCounter");
    expect(nodes).toContain("src/counter"); // Always exists, but let's check reachability

    // 6. Check main:render manager loaders
    // In our surgical world, main:render should depend on src/counter:setupCounter
    // but src/counter (the top level) should only be reachable if it's dynamic or explicitly imported

    const renderNode = state.boundaryGraph.nodes.get("src/main:render");
    const renderDeps = renderNode?.deps.map((d) => d.id);
    expect(renderDeps).toContain("src/counter:setupCounter");
    expect(renderDeps).not.toContain("src/counter");

    // 7. Verify chunk content
    const chunkGraph = state.chunkGraph;
    const renderOwner = chunkGraph.boundaryToOwner.get("src/main:render");
    const manager = await compiler.generateManager(renderOwner!, "ar");

    // "Hello Top Level" should NOT be in the manager
    expect(manager).toContain("Inside Function");
    expect(manager).not.toContain("Hello Top Level");
  });

  it("should create surgical boundaries for local functions in entry files", async (context: TestContext) => {
    const root = context.root!;
    const mainTs = `
      import { zintl, t } from "zintl";
      
      function localFunc() {
        return t("Local Message");
      }

      async function render() {
        await zintl("ar");
        localFunc();
      }
    `;
    await writeFile(join(root, "src/main.ts"), mainTs);

    const compiler = new ZintlCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true,
    );

    await compiler.transform(mainTs, join(root, "src/main.ts"), "src/main.ts");

    const state = await compiler.getDiagnosticWorldState();
    const nodes = Array.from(state.boundaryGraph.nodes.keys());

    expect(nodes).toContain("src/main:render");
    expect(nodes).toContain("src/main:localFunc");

    const renderNode = state.boundaryGraph.nodes.get("src/main:render");
    expect(renderNode?.deps.map((d) => d.id)).toContain("src/main:localFunc");
  });
});
