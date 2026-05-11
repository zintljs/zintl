import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: vanilla-spa-basic (SPA)
 *
 * All three tests use createExampleContext so the example's real vite.config.ts
 * is always the source of truth — plugin options, aliases, and env are identical
 * to what a real user would have.
 *
 * - Dev / Prod transform tests  → mode: "development" | "production" + project()
 * - Full build test             → build()  (always production, cached)
 */
describe("Example Proof: vanilla-spa-basic", () => {
  it("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("vanilla-spa-basic", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    // const mainCode = results["src/main.ts"];

    // Identity keys in dev — string values used directly
    // ctx.matchers.toRegisterT(mainCode, "Zintl I18n!", mainEntryId, { context: "h1" });

    // @zintl-ignore sites must pass through unchanged
    // expect(mainCode).toContain('<button id="set-ar">العربية</button>');
    // expect(mainCode).not.toContain('t("العربية"');

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-basic/dev-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 15000);

  it("should match Production snapshots (Baking)", async () => {
    const ctx = await createExampleContext("vanilla-spa-basic", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    const mainCode = results["src/main.ts"];
    const mainEntryId = "src/main:render";

    // In this example configuration, main.ts uses t() while counter.ts bakes
    ctx.matchers.toHandshake(mainCode, mainEntryId);
    // ctx.matchers.toRegisterT(mainCode, "Zintl I18n", mainEntryId, { context: "h1" });

    // src/counter.ts has its own boundary. In this dynamic-anchor example, it stays wrapped.
    // ctx.matchers.toRegisterT(counterCode, "Count is {counter}", mainEntryId, {
    //   context: "innerHTML",
    //   sourceBoundaryPath: "src/main.ts",
    // });

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-basic/prod-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 15000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-spa-basic");

    const distResults = await ctx.build();
    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-basic/dist/${file}`);
    }
    await ctx.cleanup();
  }, 15000);
});
