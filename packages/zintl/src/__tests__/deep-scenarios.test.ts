import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
// TODO: this need another visit from vision pro
/**
 * Deep Meditations Suite (Baseline of Shame 3.0)
 *
 * Focusing on "The Invisibles": Hierarchy failures, Bundle bloat,
 * Key collisions, and HMR memory/registry leaks.
 */
describe("Scenario: Deep Meditations", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    ctx = await createZintlContext({ logLevel: "silent" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("Meditation 5: The Homeless Parent (Hierarchy Failure)", async () => {
    const files = {
      "src/main.ts": `import "./parent";`,
      "src/child.ts": `import { zintl, t } from "zintljs"; zintl(window.navigator.language || "en"); document.body.innerHTML = "Child Msg";`,
      "src/parent.ts": `import { t } from "zintljs"; import "./child"; document.body.innerHTML = "Parent Msg";`,
    };

    const results = await ctx.project(files);
    const { matchers } = ctx;

    // Parent.ts becomes its own entry because its child opted out to be a dictator
    const parentBId = "b_c2bbdf8d0ad2";
    matchers.toRegisterManager(results["src/parent.ts"], parentBId, { locale: "none" });

    // In Dev Mode (or with no anchor), it MUST wrap content to t()
    expect(results["src/parent.ts"]).toContain("t(");

    expect(results).toMatchSnapshot();
  });

  it("Meditation 6: The Transitive Bloat (Dependency Trap)", async () => {
    const heavyStrings = Array.from(
      { length: 10 },
      (_, i) => `document.body.innerHTML = "Heavy ${i}"`,
    ).join("; ");
    const files = {
      "src/main.ts": `import { zintl } from "zintljs"; zintl(window.navigator.language || "en"); import { VERSION } from "./utils"; console.log(VERSION);`,
      "src/heavy.ts": `import { t } from "zintljs"; export const heavy = () => { ${heavyStrings} };`,
      "src/utils.ts": `import { heavy } from "./heavy"; export const VERSION = "1.0";`,
    };

    const results = await ctx.project(files);
    const { matchers } = ctx;

    // Transitive consolidation check: heavy should be served by the entry it reaches
    // In ZRS, colonies share the manager of their Kingdom (the entry point)
    const mainBId = "src/main";
    matchers.toRegisterManager(results["src/heavy.ts"], mainBId, { locale: "none" });

    expect(results).toMatchSnapshot();
  });

  it("Meditation 7: The Duplicate Key Collision", async () => {
    const files = {
      "src/main.ts": `import { zintl } from "zintljs"; zintl("en"); import "./auth"; import "./profile";`,
      "src/auth.ts": `// @zintl-note User login button\ndocument.body.innerHTML = "Submit";`,
      "src/profile.ts": `// @zintl-note Save profile changes\ndocument.body.innerHTML = "Submit";`,
    };

    const results = await ctx.project(files);
    const { matchers } = ctx;

    // Different notes -> Different keys/managers if they are separate entries
    // Since src/main imports them, they should be consolidated.
    // If they are consolidated, they share src/main's manager.

    matchers.toBeBakedTo(results["src/auth.ts"], 'document.body.innerHTML = "Submit";');
    matchers.toBeBakedTo(results["src/profile.ts"], 'document.body.innerHTML = "Submit";');

    expect(results).toMatchSnapshot();
  });

  // it("Meditation 8: The HMR Zombie (Registry Leak Simulation)", async () => {
  //   const mainPath = "src/main.ts";
  //   const mainSrc = (i: number) => `import { zintl, t } from "zintljs"; zintl("en"); console.log("Msg ${i}");`;

  //   // Simulate 5 HMR updates
  //   const results: Record<string, string> = {};
  //   for (let i = 0; i < 5; i++) {
  //       const code = await ctx.transform(mainPath, mainSrc(i));
  //       results[`update_${i}`] = code;

  //       ctx.matchers.toRegisterManager(code, "src/main", { locale: "en" });
  //   }

  //   expect(results).toMatchSnapshot();
  // });
});
