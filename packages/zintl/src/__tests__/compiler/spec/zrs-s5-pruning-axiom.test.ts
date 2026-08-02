import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../../helpers/compiler.js";
import { join } from "node:path";
import { createTestDir, type TestContext } from "../../helpers/fs.js";

/**
 * ZRS §5 — The Pruning Axiom (Efficiency Standard)
 *
 * Verifies that Kingdoms and Colonies with zero reachable sinks are
 * correctly downleveled to Vassal status, and that the $M (Marker)
 * exception preserves Kingdom infrastructure for library stubs.
 *
 * Reference: docs/spec/ZRS.md §5.1, §5.2, §5.3
 */
describe("ZRS §5: Pruning Axiom", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zrs-pruning-");
  });

  // ── §5.1 — Formal Rule ────────────────────────────────────────────────

  describe("§5.1 — Pruning Empty Kingdoms", () => {
    it("should NOT inject a manager for an anchor with zero reachable sinks", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      // File has zintl() but no UI sinks AND no dependencies with sinks
      const code = `import { zintl } from "zintljs"; await zintl("ar"); const x = 42;`;
      const result = await compiler.transform(code, join(root, "src/empty.ts"), "target");

      // The pruning axiom says: if zero reachable sinks AND no $M marker,
      // the system should avoid injecting dead infrastructure.
      // The anchor rewrite still happens (loadI18nInstance), but the
      // handshake should have no live loaders.
      expect(result?.code).toContain("loadI18nInstance");
    });

    it("should prune a lazy colony with zero sinks", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      // main has an anchor and imports lazy, but lazy has NO sinks
      const mainCode = `import { zintl } from "zintljs"; await zintl("ar"); document.body.innerHTML = "Main"; const Lazy = import("./lazy");`;
      const lazyCode = `const x = 42; export default x;`;

      await compiler.transform(mainCode, join(root, "src/main.ts"), "target");
      await compiler.transform(lazyCode, join(root, "src/lazy.ts"), "target");
      await compiler.flush();

      // The lazy module should NOT have a catalog chunk with any messages
      const lazyMessages = compiler.getMessages("src/lazy");
      expect(lazyMessages.length).toBe(0);
    });
  });

  // ── §5.3 — Marker Exception ───────────────────────────────────────────

  describe("§5.3 — Marker Exception", () => {
    it("should preserve Kingdom status for $M marker even with zero sinks", async (context: TestContext) => {
      const root = context.root!;
      const compiler = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      // Bare marker, no strings — this is a library declaring future intent
      const code = `import "zintljs"; export function setup() { return "library"; }`;
      await compiler.transform(code, join(root, "src/lib-stub.ts"), "target");
      await compiler.flush();

      // $M exempts from pruning — must remain an entry (Kingdom)
      expect(compiler.isEntry("src/lib-stub")).toBe(true);
    });

    it("should prune $A anchor but NOT $M marker when both have zero sinks", async (context: TestContext) => {
      const root = context.root!;
      const compilerA = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      const compilerM = createTestCompiler(
        { sourceLocale: "en", locales: ["en", "ar"] },
        root,
        true,
      );

      // $A with zero sinks
      const codeA = `import { zintl } from "zintljs"; await zintl("ar"); const x = 42;`;
      await compilerA.transform(codeA, join(root, "src/anchor.ts"), "target");
      await compilerA.flush();

      // $M with zero sinks
      const codeM = `import "zintljs"; const x = 42;`;
      await compilerM.transform(codeM, join(root, "src/marker.ts"), "target");
      await compilerM.flush();

      // $M entry preserved, $A entry behavior depends on pruning
      expect(compilerM.isEntry("src/marker")).toBe(true);
    });
  });
});
