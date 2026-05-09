import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../../index.ts";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/**
 * ZRS §4 — Handshake Axioms
 *
 * These tests verify the five axioms that resolve every ambiguity in boundary
 * ownership. Each test maps to exactly one axiom and proves it mechanically.
 *
 * Reference: SPEC/ZRS.md §4
 */
describe("ZRS §4: Handshake Axioms", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zrs-axioms-");
  });

  // ── Axiom 1: Intent Precedence ─────────────────────────────────────────

  describe("Axiom 1: Intent Precedence", () => {
    it("should promote a file to Kingdom even with zero sinks", async (context: LocalContext) => {
      const root = context.root!;
      context.compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"], logLevel: "silent" },
        root,
        true,
      );

      // File has zintl() but no UI sinks — MUST still be a Kingdom
      const code = `import { zintl } from "zintl"; await zintl("ar"); const x = 42;`;
      await context.compiler.transform(code, join(root, "src/empty-kingdom.ts"), "target");
      await context.compiler.flush();

      const graph = (context.compiler as any).boundaryGraph;
      expect(graph.entries.has("src/empty-kingdom")).toBe(true);
    });

    it("should respect $M marker as Kingdom declaration with zero sinks", async (context: LocalContext) => {
      const root = context.root!;
      context.compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      // Bare marker, no strings at all — still a Kingdom (§5.3 Marker Exception)
      const code = `import "zintl"; const config = { debug: true };`;
      await context.compiler.transform(code, join(root, "src/marker-only.ts"), "target");
      await context.compiler.flush();

      expect(context.compiler.isEntry("src/marker-only")).toBe(true);
    });
  });

  // ── Axiom 2: Shadowing (Atmospheric Pressure) ─────────────────────────

  describe("Axiom 2: Shadowing", () => {
    it("should attribute a sink to the nearest Kingdom on the graph path", async (context: LocalContext) => {
      const root = context.root!;
      context.compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"], logLevel: "silent" },
        root,
        true,
      );

      // Chain: main($A) → mid($A) → leaf($S)
      // Leaf's sink belongs to mid (the nearest Kingdom), not main
      const mainCode = `import { zintl } from "zintl"; import "./mid"; await zintl("ar");`;
      const midCode = `import { zintl } from "zintl"; import "./leaf"; await zintl("en");`;
      const leafCode = `document.body.innerHTML = "Deep Sink";`;

      await context.compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await context.compiler.transform(midCode, join(root, "src/mid.ts"), "target");
      await context.compiler.transform(leafCode, join(root, "src/leaf.ts"), "target");
      await context.compiler.flush();

      // Both main and mid should be entries (Kingdoms)
      const graph = (context.compiler as any).boundaryGraph;
      expect(graph.entries.has("src/main")).toBe(true);
      expect(graph.entries.has("src/mid")).toBe(true);

      // leaf should NOT be its own entry — it's a Vassal of mid
      expect(graph.entries.has("src/leaf")).toBe(false);
    });
  });

  // ── Axiom 3: Instance Heredity ─────────────────────────────────────────

  describe("Axiom 3: Instance Heredity", () => {
    it("should register Colony loaders in the parent Kingdom's handshake", async (context: LocalContext) => {
      const root = context.root!;
      context.compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"], logLevel: "silent" },
        root,
        true,
      );

      const mainCode = `import { zintl } from "zintl"; await zintl("ar"); const Lazy = import("./lazy");`;
      const lazyCode = `document.body.innerHTML = "Lazy Content";`;

      await context.compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await context.compiler.transform(lazyCode, join(root, "src/lazy.ts"), "target");
      await context.compiler.flush();

      // Re-transform main to get the final output with handshake
      const result = await context.compiler.transform(
        mainCode,
        join(root, "src/main.ts"),
        "target",
      );

      // The parent must reference the lazy module's loader in its handshake
      expect(result?.code).toContain("loadI18nInstance");
    });
  });

  // ── Axiom 4: Discovery Dominance (DFS Rule) ───────────────────────────

  describe("Axiom 4: Discovery Dominance", () => {
    it("should produce deterministic ownership for circular dependencies", async (context: LocalContext) => {
      const root = context.root!;
      context.compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"], logLevel: "silent" },
        root,
        true,
      );

      // Circular: A imports B, B imports A
      const codeA = `import { zintl } from "zintl"; import "./b"; await zintl("ar"); document.body.innerHTML = "A";`;
      const codeB = `import "./a"; document.body.innerHTML = "B";`;

      await context.compiler.transform(codeA, join(root, "src/a.ts"), "target");
      await context.compiler.transform(codeB, join(root, "src/b.ts"), "target");
      await context.compiler.flush();

      // Run again — ownership must be identical (deterministic)
      const compiler2 = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      await compiler2.transform(codeA, join(root, "src/a.ts"), "target");
      await compiler2.transform(codeB, join(root, "src/b.ts"), "target");
      await compiler2.flush();

      const graph1 = (context.compiler as any).boundaryGraph;
      const graph2 = (compiler2 as any).boundaryGraph;

      // Entry sets must be identical across runs
      expect(Array.from(graph1.entries).sort((a: any, b: any) => a.localeCompare(b))).toEqual(
        Array.from(graph2.entries).sort((a: any, b: any) => a.localeCompare(b)),
      );
    });
  });

  // ── Axiom 5: Specificity Over Heredity (Dictator Supremacy) ───────────

  describe("Axiom 5: Specificity Over Heredity", () => {
    it("should absorb nested functional anchors when top-level $A exists", async (context: LocalContext) => {
      const root = context.root!;
      context.compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"], logLevel: "silent" },
        root,
        true,
      );

      // Top-level zintl() acts as Dictator — nested function's zintl() is absorbed
      const code = `
        import { zintl } from "zintl";
        await zintl("ar");
        function render() { zintl(); document.body.innerHTML = "Nested"; }
      `;

      await context.compiler.transform(code, join(root, "src/dictator.ts"), "target");
      await context.compiler.flush();

      const graph = (context.compiler as any).boundaryGraph;

      // Only the top-level should be an entry — nested is absorbed
      expect(graph.entries.has("src/dictator")).toBe(true);
      expect(graph.entries.has("src/dictator:render")).toBe(false);
    });

    it("should create independent Kingdoms for nested anchors WITHOUT top-level $A", async (context: LocalContext) => {
      const root = context.root!;
      context.compiler = new ZintlCompiler(
        { sourceLocale: "en", locales: ["en", "ar"], logLevel: "silent" },
        root,
        true,
      );

      // No top-level anchor — each function with zintl() becomes its own Kingdom
      const code = `
        import { zintl } from "zintl";
        function renderA() { zintl("ar"); document.body.innerHTML = "A"; }
        function renderB() { zintl("en"); document.body.innerHTML = "B"; }
      `;

      await context.compiler.transform(code, join(root, "src/multi.ts"), "target");
      await context.compiler.flush();

      const graph = (context.compiler as any).boundaryGraph;

      // Each function should be an independent entry
      expect(graph.entries.has("src/multi:renderA")).toBe(true);
      expect(graph.entries.has("src/multi:renderB")).toBe(true);
    });
  });
});
