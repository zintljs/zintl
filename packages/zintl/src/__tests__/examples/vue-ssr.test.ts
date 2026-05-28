import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: vue-ssr (Vue SSR)
 *
 * This test verifies the output of the vue-ssr example in its current state.
 */
describe("Example Proof: vue-ssr", () => {
  // -------------------------------------------------------------------------
  // Phase 1: Development transforms
  // -------------------------------------------------------------------------
  it("should match Development snapshots", async () => {
    const ctx = await createExampleContext("vue-ssr", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-ssr/dev-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  // -------------------------------------------------------------------------
  // Phase 2: Production transforms
  // -------------------------------------------------------------------------
  it("should match Production snapshots", async () => {
    const ctx = await createExampleContext("vue-ssr", { mode: "production" });

    const results = await ctx.project();

    const compiler = (ctx as any).plugin.__compiler;
    await compiler.syncGraphs(true);

    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-ssr/prod-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  // -------------------------------------------------------------------------
  // Phase 3: Final Client Production Build (dist/client)
  // -------------------------------------------------------------------------
  it("should match Final Client Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vue-ssr");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-ssr/dist/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  // -------------------------------------------------------------------------
  // Phase 4: Server SSR Build (dist/server)
  // -------------------------------------------------------------------------
  it("should match Final Server SSR Build (dist/server) snapshots", async () => {
    const ctx = await createExampleContext("vue-ssr", {
      overrides: {
        build: {
          ssr: "src/entry-server.ts",
        },
      },
    });

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vue-ssr/dist-server/${file}`);
    }
    await ctx.cleanup();
  }, 25000);
});
