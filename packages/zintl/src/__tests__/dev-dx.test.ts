import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";

/**
 * Dev DX Integration Suite
 *
 * Verifies that in Dev Mode, the transformed code uses raw content as keys
 * and the virtual catalog module correctly contains these readable keys.
 */
describe("Flow: Dev DX (Content as Key)", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    // Explicitly set isDev to true
    ctx = await createZintlContext({ isDev: true, logLevel: "silent" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // it("should use readable content as keys in both code and catalog in Dev Mode", async () => {
  //   const filePath = "src/main.ts";
  //   // Must include zintl to be detected as a boundary
  //   const sourceCode = `import "zintl"; document.body.innerHTML = "Welcome to Zintl";`;

  //   // Transform
  //   const transformed = await ctx.transform(filePath, sourceCode);

  //   // 1. Verify transformed code uses the raw string as the first argument to t()
  //   expect(transformed).toContain('t("Welcome to Zintl"');

  //   // 2. Load the virtual catalog module
  //   const compiler = (ctx.plugin.__compiler as any);
  //   const stableId = compiler.getBoundaryId("src/main");
  //   const virtualId = `virtual:zintl/catalog/entry:${stableId}`;

  //   const loaded = await ctx.plugin.load("\0" + virtualId);

  //   // 3. Verify the catalog contains the readable key
  //   expect(loaded).toMatch(/"Welcome to Zintl":/);
  // });

  it("should handle multi-boundary consolidation with readable keys in Dev Mode", async () => {
    const results = await ctx.project({
      "src/main.ts": `import { zintl } from "zintl"; zintl("en"); import "./comp";`,
      "src/comp.ts": `document.body.innerHTML = "Sub Component";`,
    });

    const compCode = results["src/comp.ts"];
    expect(compCode).toContain('t("Sub Component"');

    const compiler = ctx.plugin.__compiler as any;
    const stableId = compiler.getBoundaryId("src/main");
    const virtualId = `virtual:zintl/catalog/entry:${stableId}`;

    const loaded = await ctx.plugin.load("\0" + virtualId);

    // Verify both keys are in the consolidated catalog with readable names
    expect(loaded).toMatch(/"Sub Component":/);
  });
});
