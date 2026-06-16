import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: vinext-basic (Next.js on Vite)
 *
 * This test verifies the output of the vinext-basic example in its current state.
 */
describe("Example Proof: vinext-basic", () => {
  it("should match Development snapshots", async () => {
    const ctx = await createExampleContext("vinext-basic", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vinext-basic/dev-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 30000);

  it("should match Production snapshots", async () => {
    const ctx = await createExampleContext("vinext-basic", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vinext-basic/prod-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 30000);

  it.skip("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vinext-basic");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vinext-basic/dist/${file}`);
    }

    await ctx.cleanup();
  }, 30000);
});
