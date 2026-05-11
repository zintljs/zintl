import { describe, it, expect } from "vite-plus/test";
import { createExampleContext } from "../helpers/examples-harness.ts";
import { join, relative } from "node:path";
import { readdir, readFile } from "node:fs/promises";

/**
 * Example Proof: Baked Multi-SPA
 *
 * This test verifies that Zintl can handle a multi-SPA architecture
 * where each locale is baked into its own entry point via virtual modules.
 */
describe("Example Proof: vanilla-spa-i18n-baked", () => {
  it("should match Development snapshots (Identity keys)", async () => {
    const ctx = await createExampleContext("vanilla-spa-i18n-baked", { mode: "development" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-i18n-baked/dev-transforms/${file}`);
    }
    // await ctx.cleanup();
  }, 30000);

  it("should match Production snapshots (Baking)", async () => {
    const ctx = await createExampleContext("vanilla-spa-i18n-baked", { mode: "production" });

    const results = await ctx.project();
    const snapshotContent = ctx.filterForSnapshots(results);

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-i18n-baked/prod-transforms/${file}`);
    }
    // await ctx.cleanup();
  }, 15000);

  // it("should match Final Production Build (dist) snapshots", async () => {
  //   const ctx = await createExampleContext("vanilla-spa-i18n-baked");

  //   const distResults = await ctx.build();
  //   const snapshotContent = ctx.filterDistForSnapshots(distResults);

  //   for (const [file, code] of Object.entries(snapshotContent)) {
  //     expect(code).toMatchSnapshot(`vanilla-spa-i18n-baked/dist/${file}`);
  //   }

  //   // Verify presence of localized index files in dist
  //   expect(distResults["en/index.html"]).toBeDefined();
  //   expect(distResults["ar/index.html"]).toBeDefined();
  //   expect(distResults["es/index.html"]).toBeDefined();
  //   expect(distResults["zh/index.html"]).toBeDefined();

  //   await ctx.cleanup();
  // }, 15000);

  it("should match Final Production Build (dist) snapshots", async () => {
    const ctx = await createExampleContext("vanilla-spa-i18n-baked");

    // Use a real build command to ensure perfect baking and resolution
    const { execSync } = await import("node:child_process");
    const cleanEnv: Record<string, string | undefined> = { ...process.env, NODE_ENV: "production" };
    delete cleanEnv["VITEST"];
    const examplesRoot = join(process.cwd(), "examples");

    execSync("vp run vanilla-spa-i18n-baked#build -- --logLevel silent", {
      cwd: process.cwd(),
      env: cleanEnv,
      stdio: "inherit",
    });

    // Read the results from the real dist folder
    const distPath = join(examplesRoot, "vanilla-spa-i18n-baked", "dist");
    const distResults: Record<string, string> = {};
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          const relPath = relative(distPath, fullPath);
          if (relPath.match(/\.(js|html|json)$/)) {
            distResults[relPath] = await readFile(fullPath, "utf-8");
          }
        }
      }
    };
    await walk(distPath);

    const snapshotContent = ctx.filterDistForSnapshots(distResults);

    // Verify presence of localized index files in dist
    expect(distResults["en/index.html"]).toBeDefined();
    expect(distResults["ar/index.html"]).toBeDefined();
    expect(distResults["es/index.html"]).toBeDefined();

    for (const [file, code] of Object.entries(snapshotContent)) {
      expect(code).toMatchSnapshot(`vanilla-spa-i18n-baked/dist/${file}`);
    }
    await ctx.cleanup();
  }, 30000); // Production build can take longer
});
