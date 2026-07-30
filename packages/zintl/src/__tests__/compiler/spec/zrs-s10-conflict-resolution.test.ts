import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../../helpers/compiler.js";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../../helpers/fs.js";

/**
 * ZRS §10 — Conflict Resolution
 *
 * Verifies the compiler's behavior in every conflict scenario listed
 * in the ZRS §10 resolution table. These are the edge cases that would
 * otherwise cause "undefined behavior" in the system.
 *
 * Reference: SPEC/ZRS.md §10
 */
describe("ZRS §10: Conflict Resolution", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zrs-conflicts-");
  });

  // ── Colony with its own $A → Kingdom ──────────────────────────────────

  describe("Colony + $A → Kingdom (Axiom 1 Override)", () => {
    it("should promote a lazily-imported file to Kingdom when it has $A", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); const Sub = import("./sub");`;
      const subCode = `import { zintl } from "zintl"; await zintl("en"); document.body.innerHTML = "Sub";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(subCode, join(root, "src/sub.ts"), "target");
      await compiler.flush();

      // Sub is reached via dynamic import (would be Colony) BUT has $A → Kingdom
      const graph = (compiler as any).boundaryGraph;
      expect(graph.entries.has("src/sub")).toBe(true);
    });
  });

  // ── Dynamic import of file with $M → Kingdom ─────────────────────────

  describe("Dynamic import + $M → Kingdom", () => {
    it("should promote a lazily-imported file to Kingdom when it has $M marker", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); const Lib = import("./lib");`;
      // The lib uses $M to declare Kingdom intent
      const libCode = `import "zintl"; document.body.innerHTML = "Library Content";`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(libCode, join(root, "src/lib.ts"), "target");
      await compiler.flush();

      // $M overrides Colony status → Kingdom
      expect(compiler.isEntry("src/lib")).toBe(true);
    });
  });

  // ── Circular Dependency Determinism ───────────────────────────────────

  describe("Circular Dependency Determinism", () => {
    it("should produce identical chunk graphs across multiple compilations", async (context: TestContext) => {
      const root = context.root!;
      const runs: string[][] = [];

      for (let i = 0; i < 3; i++) {
        const compiler = createTestCompiler(
          { sourceLocale: "en", locales: ["en", "ar"] },
          root,
          true,
        );

        const codeA = `import { zintl } from "zintl"; import "./b"; await zintl("ar"); document.body.innerHTML = "A";`;
        const codeB = `import "./a"; document.body.innerHTML = "B";`;

        await compiler.transform(codeA, join(root, "src/a.ts"), "target");
        await compiler.transform(codeB, join(root, "src/b.ts"), "target");
        await compiler.flush();

        const graph = (compiler as any).boundaryGraph;
        runs.push(Array.from(graph.entries as Set<string>).sort());
      }

      // All runs must produce identical entry sets
      expect(runs[0]).toEqual(runs[1]);
      expect(runs[1]).toEqual(runs[2]);
    });
  });

  // ── Multi-Anchor Module ───────────────────────────────────────────────

  describe("Multi-Anchor Module (No Top-Level)", () => {
    it("should create independent Kingdoms for each functional anchor", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      const code = `
        import { zintl } from "zintl";
        function setupHeader() { zintl("ar"); document.body.innerHTML = "Header"; }
        function setupFooter() { zintl("en"); document.body.innerHTML = "Footer"; }
      `;

      await compiler.transform(code, join(root, "src/multi.ts"), "target");
      await compiler.flush();

      // Each function is its own Kingdom
      const graph = (compiler as any).boundaryGraph;
      expect((graph.entries as Set<string>).has("src/multi:setupHeader")).toBe(true);
      expect((graph.entries as Set<string>).has("src/multi:setupFooter")).toBe(true);

      // The file itself should NOT be an entry (no top-level anchor)
      expect((graph.entries as Set<string>).has("src/multi")).toBe(false);
    });
  });

  // ── Top-Level Absorbs Nested (Dictator Supremacy) ─────────────────────

  describe("Dictator Supremacy (Top-Level Absorbs Nested)", () => {
    it("should merge all nested functional boundaries into the top-level Kingdom", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      const code = `
        import { zintl } from "zintl";
        await zintl("ar");
        document.body.innerHTML = "Top Level";
        function render() { zintl(); document.body.innerHTML = "Nested"; }
      `;

      await compiler.transform(code, join(root, "src/dictator.ts"), "target");
      await compiler.flush();

      const graph = (compiler as any).boundaryGraph;

      // Top-level is the sole Kingdom
      expect((graph.entries as Set<string>).has("src/dictator")).toBe(true);
      // Nested function is absorbed — NOT an independent entry
      expect((graph.entries as Set<string>).has("src/dictator:render")).toBe(false);
    });
  });

  // ── Dev Mode vs Production Consistency ────────────────────────────────

  describe("Dev/Prod Consistency", () => {
    it("should classify the same module identically in dev and prod modes", async (context: TestContext) => {
      const root = context.root!;
      const devCompiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );
      const prodCompiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        false,
      );

      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); document.body.innerHTML = "Hello";`;
      const lazyCode = `document.body.innerHTML = "Lazy";`;

      // Dev run
      await devCompiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await devCompiler.transform(lazyCode, join(root, "src/lazy.ts"), "target");
      await devCompiler.flush();

      // Prod run
      await prodCompiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await prodCompiler.transform(lazyCode, join(root, "src/lazy.ts"), "target");
      await prodCompiler.flush();

      const devGraph = (devCompiler as any).boundaryGraph;
      const prodGraph = (prodCompiler as any).boundaryGraph;

      // Entry classification must be identical
      expect(Array.from(devGraph.entries as Set<string>).sort()).toEqual(
        Array.from(prodGraph.entries as Set<string>).sort(),
      );
    });
  });
});
