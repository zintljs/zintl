import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: vanilla-ssr
 *
 * This example is the first SSR target in the Zintl suite. It uses Vite's
 * built-in SSR support with an Express server.
 */
describe("Example Proof: vanilla-ssr", () => {
  // -------------------------------------------------------------------------
  // Phase 1: Development transforms (identity keys)
  // -------------------------------------------------------------------------
  it("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("vanilla-ssr", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    // const serverEntry = results["src/entry-server.ts"];
    // expect(serverEntry).toBeDefined();

    // const clientEntry = results["src/entry-client.ts"];
    // expect(clientEntry).toBeDefined();

    // const counterCode = results["src/counter.ts"];
    // expect(counterCode).toBeDefined();

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-ssr/dev-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  // -------------------------------------------------------------------------
  // Phase 2: Production transforms (baked keys)
  // -------------------------------------------------------------------------
  it("should match Production snapshots (Baking)", async () => {
    const ctx = await createExampleContext("vanilla-ssr", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    const serverEntry = results["src/entry-server.ts"];
    expect(serverEntry).toBeDefined();

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-ssr/prod-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  // -------------------------------------------------------------------------
  // Phase 3: Final Client Production Build (dist/client)
  // -------------------------------------------------------------------------
  it("should match Final Client Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-ssr");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-ssr/dist/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  // -------------------------------------------------------------------------
  // Phase 4: Server SSR Build (dist/server)
  // -------------------------------------------------------------------------
  it("should match Final Server SSR Build (dist/server) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-ssr", {
      overrides: {
        build: {
          ssr: "src/entry-server.ts",
        },
      },
    });

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-ssr/dist-server/${file}`);
    }
    await ctx.cleanup();
  }, 25000);
});
