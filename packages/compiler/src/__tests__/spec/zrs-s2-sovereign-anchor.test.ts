import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../../index.ts";
import { join, dirname } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * ZRS §2.4 — Sovereign Anchor ($A_{sovereign}$) Tiers
 *
 * Verifies that the compiler strictly validates, enforces, and collapses sovereign anchors.
 */
describe("ZRS §2.4: Sovereign Anchor ($A_{sovereign}$)", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zrs-sovereign-");
  });

  // ── Rule 1: Root-Only Sovereignty (Strict Functional Validation) ────────

  it("should throw a compile-time error if zintl('*') is nested inside a function scope", async (context: TestContext) => {
    const root = context.root!;
    const compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const code = `
      import { zintl } from "zintl";
      async function setup() {
        await zintl("*");
      }
    `;
    const filePath = join(root, "src/nested-function.ts");

    await expect(async () => {
      await compiler.transform(code, filePath, "target");
    }).rejects.toThrowError(
      "Zintl Sovereign Error: Sovereign anchor 'zintl(\"*\")' is only valid at the root module level.",
    );
  });

  it("should throw a compile-time error if zintl('*') is in an imported subordinate file", async (context: TestContext) => {
    const root = context.root!;
    const compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const parentCode = `import "./subordinate";`;
    const subordinateCode = `import { zintl } from "zintl"; await zintl("*");`;

    const parentPath = join(root, "src/parent.ts");
    const subordinatePath = join(root, "src/subordinate.ts");

    await mkdir(dirname(parentPath), { recursive: true });
    await writeFile(parentPath, parentCode);
    await writeFile(subordinatePath, subordinateCode);

    // Populate dependency graph first by scanning/transforming parent
    await compiler.transform(parentCode, parentPath);

    // Transforming subordinate should trigger the imported subordinate guard
    await expect(async () => {
      await compiler.transform(subordinateCode, subordinatePath);
    }).rejects.toThrowError(
      "Zintl Sovereign Error: Sovereign anchor 'zintl(\"*\")' is only valid at the root entry point.",
    );
  });

  // ── Rule 3: Sovereign Dominance & Contextual Collapse ──────────────────

  it("should collapse contextual descendants into compile-time static localized boundaries", async (context: TestContext) => {
    const root = context.root!;
    const compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const entryCode = `import { zintl } from "zintl"; await zintl("*"); import "./descendant";`;
    const descendantCode = `import { zintl } from "zintl"; zintl(); document.body.innerHTML = "Descendant Msg";`;

    const entryPath = join(root, "src/entry.ts");
    const descendantPath = join(root, "src/descendant.ts");

    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(entryPath, entryCode);
    await writeFile(descendantPath, descendantCode);

    // Step 1: Extract & build graphs
    await compiler.transform(entryCode, entryPath);
    await compiler.transform(descendantCode, descendantPath);
    await compiler.flush();

    // Populate Arabic translation for Descendant Msg
    const catalogPath = compiler.getCatalogPath("src/descendant", "ar")!;
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, JSON.stringify({ "Descendant Msg": "رسالة فرعية" }));
    compiler.flushCache();

    // Step 2: Transform descendant under active multiplex 'ar' target
    const result = await compiler.transform(descendantCode, descendantPath + "?zintl-multiplex=ar");

    // The contextual anchor should collapse to "ar", baking the catalog instantly (Zero-Runtime)
    expect(result?.code).toContain("رسالة فرعية");
    expect(result?.code).not.toContain("loadI18nInstance");
    expect(result?.code).not.toContain("zintl(");
  });

  // ── Sovereign Fallback Redirection HTML Generation ──────────────────────

  it("should inject zero-config fallback client redirection script into bare index.html", async (context: TestContext) => {
    const root = context.root!;
    const compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const entryCode = `import { zintl } from "zintl"; await zintl("*");`;
    const entryPath = join(root, "src/main.ts");

    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(entryPath, entryCode);

    // Initial transform to build graph
    await compiler.transform(entryCode, entryPath);
    await compiler.flush();

    const htmlContent = `
<!doctype html>
<html>
  <head>
    <title>Sovereign Test</title>
    <script type="module" src="/src/main.ts"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

    const transformedHtml = await compiler.transformHtml(htmlContent, join(root, "index.html"));

    expect(transformedHtml).toContain('id="zintl-sovereign-redirect"');
    expect(transformedHtml).toContain("window.location.replace('/' + target + '/');");
    expect(transformedHtml).not.toContain("loadI18nInstance");
  });

  // ── Rule 4: Multi-MFE Sovereignty (Micro-Frontend Isolation) ─────────────

  it("should allow multiple independent root entry points to each call zintl('*')", async (context: TestContext) => {
    const root = context.root!;
    const compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const mfeACode = `import { zintl } from "zintl"; await zintl("*"); document.body.innerHTML = "MFE A";`;
    const mfeBCode = `import { zintl } from "zintl"; await zintl("*"); document.body.innerHTML = "MFE B";`;

    const mfeAPath = join(root, "src/mfeA.ts");
    const mfeBPath = join(root, "src/mfeB.ts");

    await mkdir(dirname(mfeAPath), { recursive: true });
    await writeFile(mfeAPath, mfeACode);
    await writeFile(mfeBPath, mfeBCode);

    // Extraction should work for both without "already has a sovereign anchor" errors
    // because they are separate entry points (distinct logical roots).
    await compiler.transform(mfeACode, mfeAPath);
    await compiler.transform(mfeBCode, mfeBPath);
    await compiler.flush();

    expect(compiler.boundaryGraph?.entries.has("src/mfeA")).toBe(true);
    expect(compiler.boundaryGraph?.entries.has("src/mfeB")).toBe(true);
  });

  // ── Rule 5: Dynamic Opt-Out under Sovereign Context ──────────────────────

  it("should allow a nested dynamic anchor to opt-out of sovereign collapse", async (context: TestContext) => {
    const root = context.root!;
    const compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar"] },
      root,
      false, // Production mode
    );

    const entryCode = `import { zintl } from "zintl"; await zintl("*"); import "./widget";`;
    const widgetCode = `
      import { zintl, t } from "zintl";
      export async function loadWidget(lang) {
        await zintl(lang); // Dynamic Opt-Out
        return t("Widget Loaded");
      }
      export const staticMsg = t("Static Content");
    `;

    const entryPath = join(root, "src/entry.ts");
    const widgetPath = join(root, "src/widget.ts");

    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(entryPath, entryCode);
    await writeFile(widgetPath, widgetCode);

    // 1. Extract
    await compiler.transform(entryCode, entryPath);
    await compiler.transform(widgetCode, widgetPath);
    await compiler.flush();

    // 2. Add translations
    const catalogPath = compiler.getCatalogPath("src/widget", "ar")!;
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(
      catalogPath,
      JSON.stringify({
        "Widget Loaded": "تم تحميل الودجت",
        "Static Content": "محتوى ثابت",
      }),
    );
    compiler.flushCache();

    // 3. Transform widget for 'ar' target
    const result = await compiler.transform(widgetCode, widgetPath + "?zintl-multiplex=ar");

    // The static message should be BAKED (collapsed into the sovereign "ar" context)
    expect(result?.code).toContain("محتوى ثابت");

    // The dynamic zintl(lang) MUST survive as a loadI18nInstance call (Opt-Out)
    expect(result?.code).toContain("loadI18nInstance");
    expect(result?.code).toContain("_t(");
  });

  // ── Rule 6: Redirection Script Locale Integrity ──────────────────────────

  it("should include all configured locales in the fallback redirection script", async (context: TestContext) => {
    const root = context.root!;
    const compiler = new ZintlCompiler(
      { sourceLocale: "en", locales: ["en", "ar", "es", "fr"] },
      root,
      false,
    );

    const entryCode = `import { zintl } from "zintl"; await zintl("*");`;
    const entryPath = join(root, "src/main.ts");
    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(entryPath, entryCode);

    await compiler.transform(entryCode, entryPath);
    await compiler.flush();

    const htmlContent = `<html><head><script src="/src/main.ts"></script></head></html>`;
    const transformedHtml = await compiler.transformHtml(htmlContent, join(root, "index.html"));

    // Verify all locales are present in the list
    expect(transformedHtml).toContain('["en","ar","es","fr"]');
    // Verify redirection logic uses the list
    expect(transformedHtml).toContain("supported.includes(lang)");
  });
});
