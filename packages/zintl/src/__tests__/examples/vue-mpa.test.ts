import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: vue-mpa (Vue MPA)
 *
 * This test verifies the output of the vue-mpa example in its current state.
 */
describe("Example Proof: vue-mpa", () => {
  it("should match Development snapshots", async () => {
    const ctx = await createExampleContext("vue-mpa", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-mpa/dev-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 20000);

  it("should match Production snapshots", async () => {
    const ctx = await createExampleContext("vue-mpa", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-mpa/prod-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 15000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vue-mpa");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-mpa/dist/${file}`);
    }

    await ctx.cleanup();
  }, 15000);
});
