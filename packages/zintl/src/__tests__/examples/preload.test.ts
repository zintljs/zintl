import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * System Proof: Catalog Preloading
 *
 * Verifies that Zintl correctly identifies hashed production chunks
 * and injects them as modulepreload links into the HTML bootstrap.
 */
describe("System Proof: Catalog Preloading", () => {
  it("should inject modulepreload links for catalogs in production build", async () => {
    const ctx = await createExampleContext("vanilla-spa-basic");

    const { execSync } = await import("node:child_process");
    const examplesRoot = join(process.cwd(), "examples");

    // Ensure the project is built
    execSync("vp run vanilla-spa-basic#build", { cwd: process.cwd() });

    const distPath = join(examplesRoot, "vanilla-spa-basic", "dist");
    const indexHtml = await readFile(join(distPath, "index.html"), "utf-8");

    // 1. Verify the preload map is present and contains hashed assets
    expect(indexHtml).toContain("const preloads = {");

    // 2. Verify that each locale has its hashed entry chunk mapped
    // Note: The b_hash is stable, but the Vite -XXXX hash is dynamic.
    expect(indexHtml).toMatch(/"ar":\["\/?assets\/entry_b_ae1e7cbb2f74-[^"]+\.js"\]/);
    expect(indexHtml).toMatch(/"es":\["\/?assets\/entry_b_ae1e7cbb2f74-[^"]+\.js"\]/);
    expect(indexHtml).toMatch(/"zh":\["\/?assets\/entry_b_ae1e7cbb2f74-[^"]+\.js"\]/);

    // 3. Verify the preload logic is injected
    expect(indexHtml).toContain("function preload(locale)");
    expect(indexHtml).toContain(`link.rel = "modulepreload"`);

    // 4. Verify that it preloads the detected locale (e.g. if l !== 'en')
    expect(indexHtml).toContain("function apply(locale) {");
    expect(indexHtml).toContain("preload(l);");

    await ctx.cleanup();
  }, 30000);
});
