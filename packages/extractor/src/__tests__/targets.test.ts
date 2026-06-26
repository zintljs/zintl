import { describe, it, expect } from "vite-plus/test";
import { resolveTargets } from "../targets.js";
import { extract } from "../parser.js";

describe("Zintl Extractor - Targets and DSL Presets", () => {
  it("should expand default presets correctly", () => {
    const resolved = resolveTargets(["react", "html"]);

    // React preset
    expect(resolved.jsxAttributes.has("aria-label")).toBe(true);
    expect(resolved.jsxAttributes.has("alt")).toBe(true);
    expect(resolved.jsxElementAttributes.get("html")?.has("dir")).toBe(true);
    expect(resolved.objectFields.has("label")).toBe(true);
    expect(resolved.objectFields.has("title")).toBe(true);

    // HTML preset
    expect(resolved.htmlAttributes.has("alt")).toBe(true);
    expect(resolved.htmlAttributes.has("aria-label")).toBe(true);
    expect(resolved.htmlAttributes.has("title")).toBe(true);
    expect(resolved.htmlAttributes.has("placeholder")).toBe(true);
    expect(resolved.htmlAttributes.has("dir")).toBe(true);

    // Vanilla preset should not be here since it wasn't requested
    expect(resolved.domProperties.has("innerHTML")).toBe(false);
  });

  it("should parse target DSL strings dynamically", () => {
    const resolved = resolveTargets([
      "jsx:button:data-custom-btn",
      "jsx:*:custom-global-attr",
      "dom:prop:customText",
      "obj:field:customField",
      "html:attr:custom-html-attr",
    ]);

    // Element-specific JSX attributes
    const buttonAttrs = resolved.jsxElementAttributes.get("button");
    expect(buttonAttrs).toBeDefined();
    expect(buttonAttrs?.has("data-custom-btn")).toBe(true);

    // Global JSX attributes
    expect(resolved.jsxAttributes.has("custom-global-attr")).toBe(true);

    // DOM properties
    expect(resolved.domProperties.has("customText")).toBe(true);

    // Object fields
    expect(resolved.objectFields.has("customField")).toBe(true);

    // HTML attributes
    expect(resolved.htmlAttributes.has("custom-html-attr")).toBe(true);

    // Fast-path hints should contain our custom ones
    expect(resolved.uniqueHints).toContain("data-custom-btn");
    expect(resolved.uniqueHints).toContain("custom-global-attr");
    expect(resolved.uniqueHints).toContain("customText");
    expect(resolved.uniqueHints).toContain("customField");
    expect(resolved.uniqueHints).toContain("custom-html-attr");
  });

  it("should cache resolved targets reference", () => {
    const run1 = resolveTargets(["react", "vanilla"]);
    const run2 = resolveTargets(["react", "vanilla"]);

    // Strict equality check (caching mechanism)
    expect(run1).toBe(run2);
  });

  it("should respect custom targets during extraction", () => {
    const code = `
      const config = {
        label: "Extract Label",
        ignoredField: "Ignore Label"
      };

      function App() {
        return (
          <div>
            <button data-custom-btn="Button Action">Submit</button>
            <span aria-label="Ignored Aria">Span</span>
          </div>
        );
      }
    `;

    // Only configure specific custom targets
    const result = extract(code, "App.tsx", "App", {
      targets: ["jsx:button:data-custom-btn", "obj:field:label"],
    });

    const messages = result.messages.map((m) => m.text);

    // Should extract custom targets
    expect(messages).toContain("Extract Label");
    expect(messages).toContain("Button Action");

    // Should ignore normal ones not configured in target
    expect(messages).not.toContain("Ignore Label");
    expect(messages).not.toContain("Ignored Aria");
  });

  it("should resolve plugin targets and DOM attributes", () => {
    const plugin1 = {
      name: "my-plugin-1",
      fastPathHint: "hint-1",
    };
    const plugin2 = {
      name: "my-plugin-2",
      fastPathHint: ["hint-2", "hint-3"],
    };

    const resolved = resolveTargets([plugin1, plugin2, "dom:attr:data-my-dom-attr", null as any]);

    expect(resolved.plugins).toContain(plugin1);
    expect(resolved.plugins).toContain(plugin2);
    expect(resolved.uniqueHints).toContain("hint-1");
    expect(resolved.uniqueHints).toContain("hint-2");
    expect(resolved.uniqueHints).toContain("hint-3");
    expect(resolved.uniqueHints).toContain("data-my-dom-attr");
  });
  it("should support extraction using a pre-resolved compiledState option", () => {
    const code = `
      const config = {
        label: "Extract Label",
      };
    `;

    const compiledState = resolveTargets(["obj:field:label"]);

    const result = extract(code, "App.tsx", "App", {
      compiledState,
    });

    const messages = result.messages.map((m) => m.text);
    expect(messages).toContain("Extract Label");
  });
});
