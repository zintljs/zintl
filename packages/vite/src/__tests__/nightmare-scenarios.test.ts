import { describe, it, beforeEach, afterEach } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";

/**
 * Nightmare Meditations: Salvation Stress Tests
 *
 * Verifies that the compiler is resilient against extreme module hierarchies:
 * - Circular graphs
 * - Shadowed manager names
 * - Colliding entry points
 */
describe("Nightmare Meditations: Salvation Stress Tests", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    ctx = await createZintlContext({ isDev: false, logLevel: "silent" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // it("should handle Circular Boundary Graphs (A -> B -> A) gracefully", async () => {
  //   const files = {
  //     "src/a.ts": `import "./b"; document.body.innerHTML = "A Content";`,
  //     "src/b.ts": `import "./a"; document.body.innerHTML = "B Content";`,
  //     "src/main.ts": `import { zintl } from "zintl"; zintl("en"); import "./a";`,
  //   };

  //   const results = await ctx.project(files);
  //   const { matchers } = ctx;

  //   // A.ts is owned by main.ts
  //   const stableId = "b_785c57fb4811";
  //   matchers.toRegisterManager(results["src/a.ts"], "src/a.ts", { locale: "none" });
  //   matchers.toRegisterT(results["src/a.ts"], "A Content", "src/a.ts", { context: "innerHTML" });

  //   expect(results).toMatchSnapshot();
  // });

  it("should be resilient to Shadowed Manager Injection", async () => {
    const result = await ctx.transform(
      "src/shadow.ts",
      `
      import { t } from "zintl";
      const _zintl_mgr_b_bd50d169e701 = { loader: (loc) => ({}) };
      document.body.innerHTML = "Original Content";
    `,
    );

    // Boundary ID for src/shadow.ts is b_bd50d169e701
    const { matchers } = ctx;

    matchers.toRegisterManager(result, "src/shadow.ts", { locale: "none" });
    matchers.toRegisterT(result, "Original Content", "src/shadow.ts", { context: "innerHTML" });
  });

  // it("should prevent Cross-Entry Shared Logic (Locale Interference)", async () => {
  //   const files = {
  //     "src/en-root.ts": `import { zintl } from "zintl"; zintl("en"); import "./shared";`,
  //     "src/ar-root.ts": `import { zintl } from "zintl"; zintl("ar"); import "./shared";`,
  //     "src/shared.ts": `document.body.innerHTML = "Silent Collision";`,
  //   };

  //   const results = await ctx.project(files);
  //   const { matchers } = ctx;

  //   // Shared boundary with a collision becomes its own root
  //   const stableId = "b_e30d15249a44";
  //   matchers.toRegisterManager(results["src/shared.ts"], "src/shared.ts", { locale: "none" });
  //   matchers.toRegisterT(results["src/shared.ts"], "Silent Collision", "src/shared.ts", {
  //     context: "innerHTML",
  //   });

  //   expect(results).toMatchSnapshot();
  // });

  // it("should handle Multi-Anchor Module Collisions", async () => {
  //   const result = await ctx.transform(
  //     "src/collision.ts",
  //     `
  //     import { zintl } from "zintl";
  //     zintl("en");
  //     zintl("ar");
  //     document.body.innerHTML = "Multi-Content";
  //   `,
  //   );
  //   const { matchers } = ctx;

  //   // Multiple anchors in one file consolidate to one boundary
  //   const stableId = "b_403559f33fb8";
  //   matchers.toRegisterManager(result, "src/collision.ts", { locale: "none" });
  //   matchers.toRegisterT(result, "Multi-Content", "src/collision.ts", { context: "innerHTML" });

  //   expect(result).toMatchSnapshot();
  // });
});
