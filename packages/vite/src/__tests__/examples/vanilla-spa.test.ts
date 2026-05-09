import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: Vanilla SPA
 *
 * This test verifies the Zintl integration in a Single Page Application context
 * with multiple independent boundaries (Header, Home, About).
 */
describe("Example Proof: vanilla-spa", () => {
  it("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("vanilla-spa", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    // Verify that zintl() calls are transformed into loadI18nInstance
    // expect(results["src/main.ts"]).not.toContain("zintl(");
    // expect(results["src/components/Header.ts"]).toContain("loadI18nInstance");
    expect(results["src/main.ts"]).toContain("loadI18nInstance");

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa/dev-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 20000);

  it("should match Production snapshots (Baking/Handshake)", async () => {
    const ctx = await createExampleContext("vanilla-spa", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    // In production, we expect handshakes and possibly inlined managers
    // expect(results["src/components/Header.ts"]).toContain("loadI18nInstance");

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa/prod-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 15000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-spa");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa/dist/${file}`);
    }

    await ctx.cleanup();
  }, 15000);
});
