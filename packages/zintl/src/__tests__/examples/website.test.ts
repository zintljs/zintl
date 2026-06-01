import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: Vanilla SPA
 *
 * This test verifies the Zintl integration in a Single Page Application context
 * with multiple independent boundaries (Header, Home, About).
 */
describe("Example Proof: website", () => {
  it("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("website", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    // Verify that zintl() calls are transformed into loadI18nInstance
    // expect(results["src/main.ts"]).not.toContain("zintl(");
    // expect(results["src/components/Header.ts"]).toContain("loadI18nInstance");
    expect(results["src/main.ts"]).toContain("loadI18nInstance");

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`website/dev-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 20000);
});
