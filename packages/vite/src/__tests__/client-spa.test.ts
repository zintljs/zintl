import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";

/**
 * High-Fidelity Integration Suite: Client-Side SPA
 *
 * Verifies the full Vite plugin lifecycle (transform, resolve, load)
 * for a standard client-side application using static anchors and baking.
 */
describe("Flow: Client-Side SPA", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    ctx = await createZintlContext({ logLevel: "silent" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("should bake static translations and not inject manager (High-Fidelity)", async () => {
    const results = await ctx.project({
      "src/main.ts": `import { zintl } from "zintl"; await zintl("en"); document.body.innerHTML = "Welcome";`,
    });

    const code = results["src/main.ts"];
    const { matchers } = ctx;

    // matchers.toHandshake(code, "src/main", { locale: "en" });
    // matchers.toRegisterManager(code, "src/main", { locale: "en" });

    // Proof of Baking: "Welcome" (English) bakes back to "Welcome" in an English build
    matchers.toBeBakedTo(code, 'document.body.innerHTML = "Welcome";');
    matchers.toNotImportFromZintl(code, ["zintl"]);
    // matchers.toImportFromZintl(code, ["loadI18nInstance"], "zintl/internal");
  });

  it("should bake template literal fragments correctly", async () => {
    const results = await ctx.project({
      "src/tmpl.ts": `import { zintl } from "zintl"; await zintl("en"); const name = "Zintl"; document.body.innerHTML = \`<div>Hello \${name}</div>\`;`,
    });

    const code = results["src/tmpl.ts"];
    const { matchers } = ctx;

    // matchers.toHandshake(code, "src/tmpl", { locale: "en" });
    // matchers.toRegisterManager(code, "src/tmpl", { locale: "en" });

    // Baking proof for fragments
    matchers.toBeBakedTo(code, "document.body.innerHTML = `<div>Hello ${name}</div>`;");
  });

  it("should resolve and load virtual catalog modules", async () => {
    const filePath = "src/main.ts";
    const sourceCode = `import { zintl } from "zintl"; await zintl("en"); document.body.innerHTML = "Welcome";`;

    // Transform once to populate manifest
    await ctx.transform(filePath, sourceCode);
    const stableId = (ctx.plugin.__compiler as any).getBoundaryId("src/main");

    // Verify virtual module resolution
    const virtualId = `virtual:zintl/content/en/entry:${stableId}`;
    const resolved = await ctx.plugin.resolveId(virtualId);
    expect(resolved).toBe("\0" + virtualId);

    // Verify loading the virtual module
    const loaded = await ctx.plugin.load(resolved);
    expect(loaded).toContain("export default {");
    ctx.matchers.toRegisterMessage(loaded, "Welcome", "Welcome");
  });
});
