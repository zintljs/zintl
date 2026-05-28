import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: vue-spa (Vue SPA)
 *
 * This test verifies the output of the vue-spa example in its current state.
 */
describe("Example Proof: vue-spa", () => {
  it("should match Development snapshots", async () => {
    const ctx = await createExampleContext("vue-spa", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-spa/dev-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 20000);

  it("should match Production snapshots", async () => {
    const ctx = await createExampleContext("vue-spa", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-spa/prod-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 15000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vue-spa");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-spa/dist/${file}`);
    }

    await ctx.cleanup();
  }, 15000);
});
