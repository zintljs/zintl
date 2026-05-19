import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

describe("Example Proof: vanilla-mpa-shared", () => {
  it("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("vanilla-mpa-shared", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-mpa-shared/dev-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  it("should match Production snapshots (Baking)", async () => {
    const ctx = await createExampleContext("vanilla-mpa-shared", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-mpa-shared/prod-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-mpa-shared");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-mpa-shared/dist/${file}`);
    }

    // Verify both index.html and about.html exist in the built distribution
    expect(distResults["index.html"]).toBeDefined();
    expect(distResults["about.html"]).toBeDefined();

    await ctx.cleanup();
  }, 20000);
});
