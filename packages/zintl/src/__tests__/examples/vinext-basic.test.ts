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

  it("should wrap Vinext virtual entry points with runInRequestScope", async () => {
    const ctx = await createExampleContext("vinext-basic");
    const compiler = (ctx.plugin as any).__compiler;

    // Test default export wrapping for virtual:vinext-rsc-entry
    const rscCode = `
export default __createAppRscHandler({
  render() { return "hello"; }
});
    `;
    const rscResult = await compiler.transform(
      rscCode,
      "\0virtual:vinext-rsc-entry",
      undefined,
      false,
      undefined,
      true,
    );
    expect(rscResult).toBeDefined();
    expect(rscResult.code).toContain("const _zintl_raw_default = ");
    expect(rscResult.code).toContain("export default function _zintl_wrapped_default(");
    expect(rscResult.code).toContain("runInRequestScope");

    // Test named export wrapping for virtual:vinext-server-entry
    const serverCode = `
export async function renderPage(request, url, manifest, ctx) {
  return "renderPage";
}
export async function handleApiRoute(request, url, ctx) {
  return "handleApi";
}
    `;
    const serverResult = await compiler.transform(
      serverCode,
      "\0virtual:vinext-server-entry",
      undefined,
      false,
      undefined,
      true,
    );
    expect(serverResult).toBeDefined();
    expect(serverResult.code).toContain("async function _zintl_raw_renderPage(");
    expect(serverResult.code).toContain("export async function renderPage(");
    expect(serverResult.code).toContain("async function _zintl_raw_handleApiRoute(");
    expect(serverResult.code).toContain("export async function handleApiRoute(");
    expect(serverResult.code).toContain("runInRequestScope");

    await ctx.cleanup();
  });

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
