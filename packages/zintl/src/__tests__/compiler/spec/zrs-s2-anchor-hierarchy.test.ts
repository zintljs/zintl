import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../../helpers/compiler.js";
import { join, dirname } from "node:path";
import { createTestDir, type TestContext } from "../../helpers/fs.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";

/**
 * ZRS §2 — Anchor Hierarchy ($A-Tiers)
 *
 * Verifies that the compiler correctly classifies anchors into their
 * respective tiers and generates the appropriate Manager strategy.
 *
 * Reference: SPEC/ZRS.md §2.1, §2.2, §2.3
 */
describe("ZRS §2: Anchor Hierarchy", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zrs-anchor-");
  });

  // ── §2.1 — $A_static (Baked Tier) ─────────────────────────────────────

  describe("§2.1 — $A_static (Baked Tier)", () => {
    it("should bake the target locale catalog in production", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        false, // Production mode
      );

      const code = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Hello";`;
      const filePath = join(root, "src/static.ts");

      // First pass: extract
      await compiler.transform(code, filePath, "target");
      await compiler.flush();

      const catalogPath = compiler.getCatalogPath("src/static", "ar")!;

      // Load current catalog and add translation
      const cat = JSON.parse(await readFile(catalogPath, "utf-8"));
      cat["Hello"] = "مرحباً";
      await writeFile(catalogPath, JSON.stringify(cat, null, 2));

      compiler.flushCache();

      // Second pass: bake
      const result = await compiler.transform(code, filePath, "target");

      // In production with literal locale, it MUST be baked (Zero-Runtime)
      expect(result?.code).toEqual('  document.body.innerHTML = "مرحباً";');
    });

    it("should not bake the target locale catalog in dev", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true, // Production mode
      );

      const code = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Hello";`;
      const filePath = join(root, "src/static.ts");

      // First pass: extract
      await compiler.transform(code, filePath, "target");
      await compiler.flush();

      // Load current catalog and add translation
      const catalogPath = compiler.getCatalogPath("src/static", "ar")!;

      const cat = JSON.parse(await readFile(catalogPath, "utf-8"));
      cat["Hello"] = "مرحباً";
      await writeFile(catalogPath, JSON.stringify(cat, null, 2));

      compiler.flushCache();

      // Second pass: bake
      const result = await compiler.transform(code, filePath, "target");

      expect(result?.code).toContain(`_t("Hello",`);
      expect(result?.code).toContain("loadI18nInstance");
      expect(result?.code).toContain("virtual:zintl/manager/ar/");
      expect(result?.code).not.toContain("مرحباً");
    });

    it("should passthrough sinks when $A_static locale matches sourceLocale", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        false, // Production mode
      );

      const code = `import { zintl } from "zintl"; await zintl("en"); document.body.innerHTML = "Hello";`;
      const filePath = join(root, "src/passthrough.ts");

      await compiler.transform(code, filePath, "target");
      await compiler.flush();
      const result = await compiler.transform(code, filePath, "target");

      // When baking to sourceLocale, sinks should NOT be wrapped in t()
      // They should remain as raw strings (Passthrough)

      expect(result?.code).toEqual('  document.body.innerHTML = "Hello";');
    });
  });

  // ── §2.2 — $A_dynamic (Governance Tier) ────────────────────────────────

  describe("§2.2 — $A_dynamic (Governance Tier)", () => {
    it("should wrap all sinks in t() when anchor is a variable expression", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        false,
      );

      const code = `import { zintl } from "zintl"; const lang = "ar"; await zintl(lang); document.body.innerHTML = "Hello";`;
      const filePath = join(root, "src/dynamic.ts");

      await compiler.transform(code, filePath, "target");
      await compiler.flush();
      const result = await compiler.transform(code, filePath, "target");

      // Dynamic anchor → sinks MUST be wrapped in t() (no passthrough possible)
      expect(result?.code).toContain("_t(");
      expect(result?.code).toContain("loadI18nInstance");
    });

    it("should generate a manager with 'none' locale for dynamic anchors", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true, // Dev mode
      );

      const code = `import { zintl } from "zintl"; const lang = detectLocale(); await zintl(lang); document.body.innerHTML = "Hello";`;
      const filePath = join(root, "src/dynamic.ts");

      const result = await compiler.transform(code, filePath, "target");

      // Manager URL must contain "none" (locale is unknown at build time)
      expect(result?.code).toContain("virtual:zintl/manager/none/");
    });
  });

  // ── §2.3 — $A_contextual (Inheritance Tier) ────────────────────────────

  describe("§2.3 — $A_contextual (Inheritance Tier)", () => {
    it("should generate a manager without an explicit locale for zintl()", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true, // Dev mode
      );

      const code = `import { zintl } from "zintl"; zintl(); const msg = "Welcome";`;
      const filePath = join(root, "src/contextual.ts");

      const result = await compiler.transform(code, filePath, "target");

      // The loadI18nInstance call must NOT contain a locale argument
      expect(result?.code).not.toContain('locale: "');
      // But it must still have the handshake
      expect(result?.code).toContain("loadI18nInstance");
    });
  });

  // ── §2.4 — Hybrid Anchor Trees ─────────────────────────────────────────

  describe("§2.4 — Hybrid Anchor Trees", () => {
    it("should bake a static child anchor even inside a dynamic parent Kingdom", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        false, // Production mode
      );

      const parentCode = `import { zintl } from "zintl"; import "./child"; await zintl(detectLocale());`;
      const childCode = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Child Msg";`;

      const parentPath = join(root, "src/parent.ts");
      const childPath = join(root, "src/child.ts");

      await mkdir(dirname(parentPath), { recursive: true });
      await writeFile(parentPath, parentCode);
      await writeFile(childPath, childCode);

      // 1. Extract
      await compiler.transform(parentCode, parentPath);
      await compiler.transform(childCode, childPath);
      await compiler.flush();

      // 2. Add translation
      const bId = "src/child";
      const catalogPath = compiler.getCatalogPath(bId, "ar")!;
      await mkdir(dirname(catalogPath), { recursive: true });
      await writeFile(catalogPath, JSON.stringify({ "Child Msg": "رسالة فرعية" }));
      compiler.flushCache();

      // 3. Bake child
      const result = await compiler.transform(childCode, childPath);

      // Child MUST be baked because its anchor is static
      expect(result?.code).toContain("رسالة فرعية");
      expect(result?.code).not.toContain("zintl(");
      expect(result?.code).not.toContain("await ;");
      expect(result?.code).not.toContain("loadI18nInstance");
    });

    it("should NOT bake a dynamic child anchor even inside a static parent Kingdom", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        false, // Production mode
      );

      const parentCode = `import { zintl } from "zintl"; import "./child"; await zintl("ar");`;
      const childCode = `import { zintl } from "zintl"; await zintl(detectLocale()); document.body.innerHTML = "Child Msg";`;

      const parentPath = join(root, "src/parent.ts");
      const childPath = join(root, "src/child.ts");

      await mkdir(dirname(parentPath), { recursive: true });
      await writeFile(parentPath, parentCode);
      await writeFile(childPath, childCode);

      // 1. Extract
      await compiler.transform(parentCode, parentPath);
      await compiler.transform(childCode, childPath);
      await compiler.flush();

      // 2. Add translation
      const catalogPath = compiler.getCatalogPath("src/child", "ar")!;
      const cat = JSON.parse(await readFile(catalogPath, "utf-8"));
      cat["Child Msg"] = "رسالة فرعية";
      await writeFile(catalogPath, JSON.stringify(cat, null, 2));

      // 3. Transform child
      const result = await compiler.transform(childCode, childPath);

      // Child MUST NOT be baked because its anchor is dynamic
      // It should still have loadI18nInstance and t() wrapping
      expect(result?.code).not.toContain("رسالة فرعية");
      expect(result?.code).toContain("loadI18nInstance");
      expect(result?.code).toContain("_t(");
    });
  });
});
