import { describe, it, expect } from "vite-plus/test";
import { observe } from "../../pipeline/observe.js";
import type { FileObservation } from "../../pipeline/types.js";
import { baseExtraction } from "../helpers/capabilities.js";

// The extractor has no default target set; a caller must declare its sinks.
const compiledState = baseExtraction();

/**
 * Phase 1 Observation Tests
 *
 * These tests verify that `observe()` correctly converts source code
 * into a pure FileObservation — facts only, no transforms, no intent.
 *
 * Mantra: The observer reports WHAT EXISTS. It never decides WHAT TO DO.
 */
describe("Pipeline Phase 1: observe()", () => {
  // ── Helper ──────────────────────────────────────────────────────────────
  function obs(code: string, fileId = "src/test"): FileObservation {
    return observe(code, `${fileId}.ts`, fileId, undefined, { compiledState });
  }

  // ── Basic Sink Detection ────────────────────────────────────────────────

  describe("UI Sink Detection (Smart Extraction)", () => {
    it("should observe innerHTML assignment as a sink", () => {
      const result = obs(`document.body.innerHTML = "Hello World";`);

      expect(result.sinks).toHaveLength(1);
      expect(result.sinks[0].text).toBe("Hello World");
      expect(result.sinks[0].sinkType).toBe("innerHTML");
      expect(result.sinks[0].boundaryId).toBe("src/test");
      expect(result.sinks[0].isFragment).toBe(false);
      expect(result.sinks[0].variables).toHaveLength(0);
    });

    it("should observe JSX text as a sink", () => {
      const result = obs(`function App() { return <h1>Submit</h1>; }`, "App");

      expect(result.sinks).toHaveLength(1);
      expect(result.sinks[0].text).toBe("Submit");
      expect(result.sinks[0].sinkType).toBe("h1");
    });

    it("should observe JSX attributes as sinks", () => {
      const result = obs(`function App() { return <button aria-label="Close" />; }`, "App");

      expect(result.sinks).toHaveLength(1);
      expect(result.sinks[0].text).toBe("Close");
      expect(result.sinks[0].sinkType).toBe("aria-label");
    });

    it("should observe object field as a sink", () => {
      const result = obs(`const config = { label: "Username" };`);

      expect(result.sinks).toHaveLength(1);
      expect(result.sinks[0].text).toBe("Username");
      expect(result.sinks[0].sinkType).toBe("label");
    });

    it("should observe template literal with variables as a sink", () => {
      const result = obs(`function App({ user }) { return <h1>Welcome, {user.name}</h1>; }`, "App");

      // JSX stitching produces the full stitched text including the variable
      const stitchedSink = result.sinks.find((s) => s.text === "Welcome, {user_name}");
      expect(stitchedSink).toBeDefined();
      expect(stitchedSink!.variables).toHaveLength(1);
      expect(stitchedSink!.variables[0].name).toBe("user_name");
    });

    it("should observe multiple sinks in the same file", () => {
      const code = `
        document.body.innerHTML = "Hello";
        document.body.textContent = "Greeting";
      `;
      const result = obs(code);

      expect(result.sinks).toHaveLength(2);
      expect(result.sinks.map((s) => s.text).sort()).toEqual(["Greeting", "Hello"]);
    });

    it("should produce ZERO sinks for non-UI code", () => {
      const result = obs(`const x = 42; console.log(x);`);

      expect(result.sinks).toHaveLength(0);
      expect(result.manualTranslations).toHaveLength(0);
    });
  });

  // ── Manual t() Detection ──────────────────────────────────────────────

  describe("Manual t() Calls", () => {
    it("should observe explicit t() as manualTranslation", () => {
      const code = `import { t } from "zintljs"; const msg = t("Submit");`;
      const result = obs(code);

      expect(result.manualTranslations).toHaveLength(1);
      expect(result.manualTranslations[0].key).toBe("Submit");
      expect(result.manualTranslations[0].boundaryId).toBe("src/test");
    });
  });

  // ── Anchor Detection ──────────────────────────────────────────────────

  describe("Trust Anchors (zintl() calls)", () => {
    it("should observe top-level zintl() with literal locale", () => {
      const code = `import { zintl } from "zintljs"; zintl("en");`;
      const result = obs(code);

      expect(result.anchors).toHaveLength(1);
      expect(result.anchors[0].isTopLevel).toBe(true);
      expect(result.anchors[0].scope).toBe("module");
      expect(result.anchors[0].locale).toEqual({ type: "literal", value: "en" });
      expect(result.anchors[0].boundaryId).toBe("src/test");
    });

    it("should set hasZintlMarker for import 'zintljs'", () => {
      const code = `import "zintljs";`;
      const result = obs(code);

      expect(result.hasZintlMarker).toBe(true);
    });

    it("should NOT set hasZintlMarker for zintl() call (it is an anchor, not a marker)", () => {
      const code = `import { zintl } from "zintljs"; zintl("ar");`;
      const result = obs(code);
      expect(result.hasZintlMarker).toBe(false);
    });
  });

  // ── Dependency Tracking ───────────────────────────────────────────────

  describe("Dependencies", () => {
    it("should observe static imports as dependencies", () => {
      // The extractor only traverses AST when UI-like content is present.
      // A pure import-only file is skipped by the fast pre-check.
      const code = `
        import { Button } from "./components/button";
        document.body.innerHTML = "Hello";
      `;
      const result = obs(code, "src/app");

      expect(result.dependencies.length).toBeGreaterThan(0);
      const staticDep = result.dependencies.find((d) => !d.dynamic);
      expect(staticDep).toBeDefined();
      expect(staticDep!.dynamic).toBe(false);
    });

    it("should observe dynamic imports as dependencies", () => {
      const code = `const Page = import("./pages/home");`;
      const result = obs(code);

      const dep = result.dependencies.find((d) => d.id.includes("home"));
      expect(dep).toBeDefined();
      expect(dep!.dynamic).toBe(true);
    });
  });

  // ── Boundary Reconstruction ───────────────────────────────────────────

  describe("Boundary Scopes", () => {
    it("should always include the file-level boundary", () => {
      const result = obs(`const x = 1;`);

      expect(result.boundaries.some((b) => b.id === "src/test")).toBe(true);
      expect(result.boundaries.find((b) => b.id === "src/test")!.scope).toBe("module");
    });

    it("should detect function-level boundaries from nested anchors", () => {
      const code = `
        import { zintl } from "zintljs";
        function render() { zintl("ar"); }
      `;
      const result = obs(code);

      const nested = result.boundaries.find((b) => b.id === "src/test:render");
      expect(nested).toBeDefined();
      expect(nested!.scope).toBe("function");
      expect(nested!.parentId).toBe("src/test");
    });
  });

  // ── Import Tracking ──────────────────────────────────────────────────

  describe("Import Observations", () => {
    it("should capture zintl import location", () => {
      const code = `import { t, zintl } from "zintljs";`;
      const result = obs(code);

      expect(result.zintlImportLocation).toBeDefined();
      expect(result.existingRuntimeImports).toContain("t");
      expect(result.existingRuntimeImports).toContain("zintl");
    });
  });

  // ── Content Hash ──────────────────────────────────────────────────────

  describe("Content Hash", () => {
    it("should produce a stable hash for same content", () => {
      const code = `document.body.innerHTML = "Test";`;
      const h1 = obs(code).contentHash;
      const h2 = obs(code).contentHash;
      expect(h1).toBe(h2);
    });

    it("should produce different hashes for different content", () => {
      const h1 = obs(`document.body.innerHTML = "Hello";`).contentHash;
      const h2 = obs(`document.body.innerHTML = "World";`).contentHash;
      expect(h1).not.toBe(h2);
    });
  });

  // ── Key Invariant: No Transforms in Output ────────────────────────────

  describe("Phase Boundary Invariant", () => {
    it("should NOT contain transforms — observation produces only facts", () => {
      const result = obs(
        `import { zintl } from "zintljs"; zintl("en"); document.body.innerHTML = "Hello";`,
      );

      // The observation has sinks (facts) but no replacement strings (intent)
      expect(result.sinks.length).toBeGreaterThan(0);
      for (const sink of result.sinks) {
        // Sinks carry raw text, not t() replacement strings
        expect(sink.text).not.toContain("t(");
        expect(sink.text).not.toContain("loadI18nInstance");
      }
    });

    it("should produce a complete FileObservation with all required fields", () => {
      const code = `
        import { zintl, t } from "zintljs";
        zintl("en");
        document.body.innerHTML = "Welcome";
        const msg = t("Manual");
      `;
      const result = obs(code);

      // Structural completeness check
      expect(result).toHaveProperty("sinks");
      expect(result).toHaveProperty("manualTranslations");
      expect(result).toHaveProperty("anchors");
      expect(result).toHaveProperty("imports");
      expect(result).toHaveProperty("dependencies");
      expect(result).toHaveProperty("boundaries");
      expect(result).toHaveProperty("directives");
      expect(result).toHaveProperty("fileId");
      expect(result).toHaveProperty("hasZintlMarker");
      expect(result).toHaveProperty("contentHash");
      expect(result).toHaveProperty("existingRuntimeImports");

      // Verify classification
      expect(result.sinks.length).toBeGreaterThan(0);
      expect(result.manualTranslations.length).toBeGreaterThan(0);
      expect(result.anchors.length).toBeGreaterThan(0);
    });
  });

  // ── HTML Fragment Detection ──────────────────────────────────────────

  describe("HTML Fragmentation", () => {
    it("should observe HTML fragments as individual sinks", () => {
      const code = `document.body.innerHTML = "<h1>Title</h1><p>Body text</p>";`;
      const result = obs(code);

      expect(result.sinks.length).toBe(2);
      expect(result.sinks.map((s) => s.text).sort()).toEqual(["Body text", "Title"]);
      // HTML fragments are inline replacements
      expect(result.sinks.every((s) => s.isFragment)).toBe(true);
    });
  });
});
