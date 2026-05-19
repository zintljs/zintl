import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: Baked Multi-SPA
 *
 * This test verifies that Zintl can handle a multi-SPA architecture
 * where each locale is baked into its own entry point via virtual modules.
 */
describe("Example Proof: vanilla-spa-i18n-baked", () => {
  it("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("vanilla-spa-i18n-baked", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-i18n-baked/dev-transforms/${file}`);
    }
    // await ctx.cleanup();
  }, 30000);

  it("should match Production snapshots (Baking)", async () => {
    const ctx = await createExampleContext("vanilla-spa-i18n-baked", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-i18n-baked/prod-transforms/${file}`);
    }
    // await ctx.cleanup();
  }, 15000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-spa-i18n-baked");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-i18n-baked/dist/${file}`);
    }

    // Verify presence of localized index files in dist
    expect(distResults["en/index.html"]).toBeDefined();
    expect(distResults["ar/index.html"]).toBeDefined();
    expect(distResults["es/index.html"]).toBeDefined();
    expect(distResults["zh/index.html"]).toBeDefined();

    await ctx.cleanup();
  }, 15000);
});
