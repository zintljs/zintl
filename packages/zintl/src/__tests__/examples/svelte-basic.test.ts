import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: svelte-basic (Svelte SPA)
 *
 * This test verifies the output of the svelte-basic example in its current state.
 */
describe("Example Proof: svelte-basic", () => {
  it("should match Development snapshots", async () => {
    const ctx = await createExampleContext("svelte-basic", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`svelte-basic/dev-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 20000);

  it("should match Production snapshots", async () => {
    const ctx = await createExampleContext("svelte-basic", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`svelte-basic/prod-transforms/${file}`);
    }

    await ctx.cleanup();
  }, 15000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("svelte-basic");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`svelte-basic/dist/${file}`);
    }

    await ctx.cleanup();
  }, 15000);
});
