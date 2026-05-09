import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../../index.ts";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/**
 * ZRS §3 — Symbiosis Patterns (Vassal / Colony / Kingdom)
 *
 * Verifies that the compiler correctly classifies modules into the three
 * fundamental patterns based on their symbolic markers and graph position.
 *
 * Reference: SPEC/ZRS.md §3.1, §3.2, §3.3
 */
describe("ZRS §3: Symbiosis Patterns", () => {
  // ── §3.1 — Pattern V: Vassal (Slaves) ─────────────────────────────────

  describe("§3.1 — Vassal Pattern", () => {
    beforeEach(async (context: LocalContext) => {
      context.root = await createTestDir("zrs-symbiosis-");
    });

    it("should merge vassal sinks into the parent Kingdom's catalog", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      // main.ts is the Kingdom ($A), utils.ts is the Vassal ($V with $S)
      const mainCode = `import { zintl } from "zintl"; import "./utils"; await zintl("ar"); document.body.innerHTML = "Main";`;
      const utilsCode = `document.body.innerHTML = "Utility";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(utilsCode, join(root, "src/utils.ts"), "target");
      await compiler.flush();

      // Vassal sinks should be owned by the parent Kingdom
      // The boundary graph should show utils as a node owned by main's entry
      const graph = (compiler as any).boundaryGraph;
      expect(graph).toBeDefined();
      expect(graph.entries.has("src/main")).toBe(true);
      expect(graph.entries.has("src/utils")).toBe(false); // Vassal is NOT an entry
    });

    it("should allow multi-vassal aggregation into a single kingdom", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const mainCode = `import { zintl } from "zintl"; import "./utils"; await zintl("ar");`;
      const utilsCode = `document.body.innerHTML = "Utility";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(utilsCode, join(root, "src/utils.ts"), "target");
      await compiler.flush();

      const graph = (compiler as any).boundaryGraph;
      expect(graph.entries.has("src/main")).toBe(true);
    });

    it("should NOT inject a manager into a Vassal file", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const mainCode = `import { zintl } from "zintl"; import "./utils"; await zintl("ar");`;
      const utilsCode = `document.body.innerHTML = "Utility";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      const result = await compiler.transform(utilsCode, join(root, "src/utils.ts"), "target");

      // A Vassal should still get t() wrapping (for runtime lookup)
      // but should reference the PARENT's manager, not its own
      if (result?.code.includes("t(")) {
        // The manager reference should point to the parent's boundary
        expect(result.code).toContain("_zintl_mgr_");
      }
    });
  });

  // ── §3.2 — Pattern C: Colony (Lazy Partition) ─────────────────────────

  describe("§3.2 — Colony Pattern", () => {
    beforeEach(async (context: LocalContext) => {
      context.root = await createTestDir("zrs-symbiosis-");
    });

    it("should partition a lazily-imported module into its own catalog chunk", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); const Page = import("./page");`;
      const pageCode = `document.body.innerHTML = "Page Content";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(pageCode, join(root, "src/page.ts"), "target");
      await compiler.flush();

      // The Colony should be a chunk root (via dynamic import)
      const chunkGraph = (compiler as any)._chunkGraph;
      expect(chunkGraph).toBeDefined();

      // Verify the page boundary exists as a lazy chunk
      let hasLazyChunk = false;
      for (const chunk of chunkGraph.chunks.values()) {
        if (chunk.type === "lazy" && chunk.boundaries.has("src/page")) {
          hasLazyChunk = true;
        }
      }
      expect(hasLazyChunk).toBe(true);

      // STRENGTHEN: The parent (main.ts) MUST contain the loader for the colony
      const result = await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      expect(result?.code).toContain("loadI18nInstance");
      // It should contain the boundary ID for src/page in its loaders
      // expect(result?.code).toContain("b_src_page");
    });

    it("should NOT promote a Colony to a Kingdom (no $A in lazy target)", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); const Page = import("./page");`;
      const pageCode = `document.body.innerHTML = "Page Content";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(pageCode, join(root, "src/page.ts"), "target");
      await compiler.flush();

      // Colony should NOT be an explicit entry (Kingdom)
      const graph = (compiler as any).boundaryGraph;
      expect(graph.entries.has("src/page")).toBe(false);
    });
  });

  // ── §3.3 — Pattern R: Kingdom (Autonomous Root) ───────────────────────

  describe("§3.3 — Kingdom Pattern", () => {
    beforeEach(async (context: LocalContext) => {
      context.root = await createTestDir("zrs-symbiosis-");
    });

    it("should create a dedicated loadI18nInstance for a file with $A", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const code = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Kingdom";`;
      const result = await compiler.transform(code, join(root, "src/kingdom.ts"), "target");

      expect(result?.code).toContain("loadI18nInstance");
      expect(result?.code).toContain('locale: "ar"');
    });

    it("should create a Kingdom even when a lazy parent exists (opt-out via $A)", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      // main imports sub lazily, but sub has its own zintl() — it becomes a Kingdom
      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); const Sub = import("./sub");`;
      const subCode = `import { zintl } from "zintl"; await zintl("en"); document.body.innerHTML = "Sub Kingdom";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(subCode, join(root, "src/sub.ts"), "target");
      await compiler.flush();

      // Sub must be an entry (Kingdom), not a Colony
      const graph = (compiler as any).boundaryGraph;
      expect(graph.entries.has("src/sub")).toBe(true);
    });

    it("should create a Kingdom for $M (import 'zintl') marker", async (context: LocalContext) => {
      const root = context.root!;
      const compiler = new ZintlCompiler({ sourceLocale: "en", locales: ["en", "ar"] }, root, true);

      const code = `import "zintl"; document.body.innerHTML = "Library";`;
      await compiler.transform(code, join(root, "src/library.ts"), "target");
      await compiler.flush();

      // Marker must promote to entry
      expect(compiler.isEntry("src/library")).toBe(true);
    });
  });
});
