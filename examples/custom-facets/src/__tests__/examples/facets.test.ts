import { describe, it, expect } from "vite-plus/test";
import { resolveFacets } from "@zintl/compiler";
import { join } from "node:path";
import { handlebarsFacet, multiBrandThemeFacet } from "../../index.js";

describe("Custom Facets Stress Tests", () => {
  describe("Handlebars Extraction & Codegen Facet", () => {
    it("resolves sfc extraction rules and matches .hbs extensions", () => {
      const facet = handlebarsFacet();
      const { system } = resolveFacets([...facet]);

      expect(system.extensions).toContain(".hbs");
    });

    it("extracts and translates HBS template under ZintlCompiler", async () => {
      const { ZintlCompiler } = await import("@zintl/compiler");
      const root = join(process.cwd(), "test-app");
      const compiler = new ZintlCompiler(
        {
          sourceLocale: "en",
          locales: ["en", "ar"],
          outputDir: "./src/i18n",
          verifyIntegrity: false,
          facets: [handlebarsFacet()],
        },
        root,
        true,
      );

      await compiler.setup();
      // Transform the raw HBS template directly
      const rawHbs = `
        <div class="hbs-container">
          <h2>Welcome to Handlebars!</h2>
          <p>Hello {{name}}!</p>
        </div>
      `;

      const result = await compiler.transform(rawHbs, join(root, "src/fake-template.hbs"));
      expect(result?.code).toContain('{{_t "Welcome to Handlebars!"');
      expect(
        Object.keys((compiler as any).messages.internalManifest).some((k) =>
          k.startsWith("src/fake-template.hbs"),
        ),
      ).toBe(true);
    });
  });

  describe("Multi-Brand Theme Facet", () => {
    it("registers brand virtual boundary and acts as content facet", () => {
      const facet = multiBrandThemeFacet();
      const { system } = resolveFacets([facet]);

      expect(system.contentFacets.some((a) => a.name === "multi-brand-theme-facet")).toBe(true);
      expect(system.virtualBoundaries).toContain("b_brand");
    });
  });
});
