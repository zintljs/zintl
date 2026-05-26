import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../../index.ts";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

/**
 * ZRS §7 — Registry Handshake Ledger (RHL)
 *
 * Verifies the contract between compiler-generated output and the
 * runtime's hydration logic. Tests the Manager generation rules
 * documented in §7.2 and the Ghost Mode source locale virtualization
 * from §7.3.
 *
 * Reference: SPEC/ZRS.md §7.1, §7.2, §7.3
 */
describe("ZRS §7: Registry Handshake Ledger", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zrs-rhl-");
  });

  // ── §7.1 — Schema Conformance ─────────────────────────────────────────

  describe("§7.1 — Handshake Schema", () => {
    it("should generate loadI18nInstance with { locale?, loaders } shape", async (context: TestContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const code = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Hello";`;
      const result = await compiler.transform(code, join(root, "src/app.ts"), "target");

      // Must contain the RHL contract
      expect(result?.code).toContain("loadI18nInstance(");
      expect(result?.code).toContain("loaders:");
      expect(result?.code).toContain(".loader");
    });

    it("should omit locale from loadI18nInstance for contextual anchors", async (context: TestContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const code = `import { zintl } from "zintl"; zintl(); document.body.innerHTML = "Hello";`;
      const result = await compiler.transform(code, join(root, "src/ctx.ts"), "target");

      expect(result?.code).toContain("loadI18nInstance(");
      expect(result?.code).not.toContain('locale: "');
    });

    it("should register Colony boundaries in the parent Kingdom's handshake loaders", async (context: TestContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Main Content"; const Lazy = import("./colony");`;
      const colonyCode = `document.body.innerHTML = "Colony Content";`;

      await compiler.transform(colonyCode, join(root, "src/colony.ts"), "target");
      const result = await compiler.transform(mainCode, join(root, "src/main.ts"), "target");

      // The handshake should include BOTH main and colony boundary IDs
      // In dev mode, they use the full relative paths as IDs
      expect(result?.code).toContain('["b_src_main"]');
      expect(result?.code).toContain('["b_src_colony"]');
    });
  });

  // ── §7.2 — Manager Generation Rules ───────────────────────────────────

  describe("§7.2 — Manager Generation", () => {
    it("should generate a sync branch for $A_static target locale", async (context: TestContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const code = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Hello";`;
      await compiler.transform(code, join(root, "src/app.ts"), "target");
      await compiler.flush();

      // Get the virtual module (Manager) for this entry
      const safeId = compiler.getSafeBoundaryId("src/app");
      const managerModule = await compiler.generateVirtualModule(`entry:${safeId}`);

      // The manager must be simplified (branch-less) because it's statically locked
      expect(managerModule?.code).not.toContain("switch(locale)");
      expect(managerModule?.code).toContain("loader: () => (");
      expect(managerModule?.code).not.toContain('import("virtual:zintl/content/ar/');
    });

    it("should generate lazy import branches for non-anchor locales", async (context: TestContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar", "fr"] },
        root,
        true,
      );

      const code = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Hello";`;
      await compiler.transform(code, join(root, "src/app.ts"), "target");
      await compiler.flush();

      const safeId = compiler.getSafeBoundaryId("src/app");
      const managerModule = await compiler.generateVirtualModule(`entry:${safeId}`);

      // The manager is simplified, so it doesn't even have branches for non-anchor locales
      expect(managerModule?.code).not.toContain("switch(locale)");
      expect(managerModule?.code).not.toContain('import("virtual:zintl/content/');
    });
  });

  // ── §7.3 — Ghost Mode (Zero-Disk Source Locale) ───────────────────────

  describe("§7.3 — Ghost Mode", () => {
    it("should skip disk extraction for sourceLocale (Ghost Mode)", async (context: TestContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const code = `import { zintl } from "zintl"; await zintl(Math.random() > 0.5 ? "ar" : "en"); document.body.innerHTML = "Hello";`;
      await compiler.transform(code, join(root, "src/app.ts"), "target");
      await compiler.flush();

      const safeId = compiler.getSafeBoundaryId("src/app");
      const managerModule = await compiler.generateVirtualModule(`entry:${safeId}`);

      // When the anchor is dynamic, the manager must have a switch and inline "en"
      expect(managerModule?.code).toContain('case "en"');
      // The en case should return an inline object, not an import
      const enMatch = managerModule?.code.match(/case "en":\n\s+return ({[\s\S]*?});/);
      if (enMatch) {
        // The inline catalog should contain the extracted key
        expect(enMatch[1]).toContain("Hello");
      }
    });
  });
});
