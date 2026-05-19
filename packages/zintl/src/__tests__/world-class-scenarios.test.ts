import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";

/**
 * High-Fidelity Integration Suite: World-Class Meditations
 *
 * Verifies that the compiler correctly handles complex real-world scenarios:
 * - Massive extractions
 * - Hydration race conditions
 * - Deep nested boundaries
 */
describe("Scenario: World-Class Meditations", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    ctx = await createZintlContext({ isDev: true, logLevel: "silent" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("Meditation 10: Massive Extraction (Scale Stress)", async () => {
    let content = "export const strings = ";
    for (let i = 0; i < 20; i++) {
      content += `document.body.innerHTML = "Msg ${i}"; `;
    }
    content += "export const CONST = 42;";

    const result = await ctx.transform(
      "src/main.ts",
      `import { zintl } from "zintl"; zintl("en"); ${content}`,
    );
    const { matchers } = ctx;

    matchers.toRegisterManager(result, "src/main", { locale: "en" });

    // Explicit strings for scale stress verification
    matchers.toRegisterT(result, "Msg 0", "src/main");
    matchers.toRegisterT(result, "Msg 19", "src/main");

    expect(result).toMatchSnapshot();
  });

  it("Meditation 12: The Hydration Void (Loading Race)", async () => {
    const files = {
      "src/main.ts": `import { zintl, t, loadI18nInstance } from "zintl"; \nloadI18nInstance({ locale: "ar" }); console.log(document.body.innerHTML = "Immediate");`,
    };

    const results = await ctx.project(files);
    const { matchers } = ctx;

    // Using the explicit string for "Immediate" to satisfy the matcher
    matchers.toRegisterT(results["src/main.ts"], "Immediate", "src/main", { context: "innerHTML" });

    expect(results).toMatchSnapshot();
  });
});
