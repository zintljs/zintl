import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";

/**
 * Example Proof: Baked Multi-Page Application (MPA)
 *
 * This test verifies that Zintl can handle a multi-entry baked MPA architecture
 * where each page and each locale are pre-rendered into their own folders
 * via virtual modules.
 */
describe("Example Proof: vanilla-mpa-baked-i18n", () => {
  it.skip("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("vanilla-mpa-baked-i18n", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-mpa-baked-i18n/dev-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 30000);

  it.skip("should match Production snapshots (Baking)", async () => {
    const ctx = await createExampleContext("vanilla-mpa-baked-i18n", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-mpa-baked-i18n/prod-transforms/${file}`);
    }
    await ctx.cleanup();
  }, 20000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-mpa-baked-i18n");

    const distResults = await ctx.build();

    // 1. Verify all localized page HTML files are produced in output
    const expectedHtmls = [
      "index.html",
      "about.html",
      "en/index.html",
      "en/about.html",
      "ar/index.html",
      "ar/about.html",
      "es/index.html",
      "es/about.html",
      "zh/index.html",
      "zh/about.html",
    ];
    for (const htmlPath of expectedHtmls) {
      expect(distResults[htmlPath]).toBeDefined();
    }

    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-mpa-baked-i18n/dist/${file}`);
    }

    // 2. Verify redirect files contain redirection script
    expect(distResults["index.html"]).toContain('id="zintl-multiplex-redirect"');
    expect(distResults["about.html"]).toContain('id="zintl-multiplex-redirect"');

    // 3. Verify HTML files have correct lang/dir attributes
    expect(distResults["ar/index.html"]).toContain('lang="ar" dir="rtl"');
    expect(distResults["en/index.html"]).toContain('lang="en"');
    expect(distResults["es/index.html"]).toContain('lang="es"');
    expect(distResults["zh/index.html"]).toContain('lang="zh"');

    await ctx.cleanup();
  }, 20000);
});
