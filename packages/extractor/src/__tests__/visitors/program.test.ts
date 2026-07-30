import { describe, it, expect } from "vite-plus/test";
import { extractBase as extract } from "../helpers/extract.js";

describe("createProgramVisitor (Integration)", () => {
  it("should handle async anchors with await", () => {
    const code = `
      import { zintl } from "zintl";
      async function setup() {
        await zintl("en");
        return <h1>Async</h1>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.anchorSites).toHaveLength(1);
    expect(result.anchorSites[0].scope).toBe("function");
    expect(result.messages.find((m) => m.text === "Async")?.boundaryId).toBe("test:setup");
  });

  it("should handle anchors wrapped in void", () => {
    const code = `
      import { zintl } from "zintl";
      void zintl("en");
      const x = <h1>Void</h1>;
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.anchorSites).toHaveLength(1);
    expect(result.mode).toBe("entry");
  });

  it("should handle anchors with .then()", () => {
    const code = `
      import { zintl } from "zintl";
      zintl("en").then(() => {
        const x = <h1>Then</h1>;
      });
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.anchorSites).toHaveLength(1);
    expect(result.mode).toBe("entry");
  });

  it("should detect manual translations via t()", () => {
    const code = `
      import { t } from "zintl";
      const msg = t("hello.world", { name: "User" });
    `;
    const result = extract(code, "test.ts", "test");
    expect(result.rawManualTranslations).toHaveLength(1);
    expect(result.rawManualTranslations[0].key).toBe("hello.world");
    expect(result.rawManualTranslations[0].paramsSource).toBe('{ name: "User" }');
  });

  it("should handle ExportDefaultDeclaration as a boundary", () => {
    const code = `
      export default function() {
        return <h1>Default</h1>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages.find((m) => m.text === "Default")?.boundaryId).toBe("test:default");
  });

  it("should handle ExportNamedDeclaration with VariableDeclaration as boundaries", () => {
    const code = `
      export const MyComponent = () => {
        return <h1>Named</h1>;
      };
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages.find((m) => m.text === "Named")?.boundaryId).toBe("test:MyComponent");
  });

  it("should handle non-exported top-level arrow functions as boundaries if they contain sinks", () => {
    const code = `
      const Internal = () => {
        return <h1>Internal</h1>;
      };
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages.find((m) => m.text === "Internal")?.boundaryId).toBe("test:Internal");
  });

  it("should mark as entry if import 'zintl' is present without specifiers", () => {
    const code = `
      import "zintl";
      const x = <h1>Marker</h1>;
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.mode).toBe("entry");
    expect(result.hasZintlMarker).toBe(true);
  });

  it("should detect sinks inside nested functions for boundary creation", () => {
    const code = `
      function Outer() {
        function Inner() {
          return <h1>Inner</h1>;
        }
        return <div>{Inner()}</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    // Outer should be the boundary for everything since Inner is nested but not an anchor
    // Wait, hasSinksOrCalls is recursive.
    // If Inner has sinks, Outer is also considered to have sinks?
    // Yes, because hasSinksOrCalls(Inner) returns true.
    expect(result.messages.find((m) => m.text === "Inner")?.boundaryId).toBe("test:Outer");
  });

  it("should respect @zintl-ignore on functions", () => {
    const code = `
      // @zintl-ignore
      function Ignored() {
        return <h1>Ignored</h1>;
      }
      function Visible() {
        return <h1>Visible</h1>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Visible");
    expect(texts).not.toContain("Ignored");
  });

  it("should skip loadI18nInstance if it already contains loaders", () => {
    const code = `
      import { loadI18nInstance } from "zintl";
      loadI18nInstance({
        locale: "en",
        loaders: { b1: () => ({}) }
      });
    `;
    const result = extract(code, "test.tsx", "test");
    // Should NOT be recorded as an anchor site because it's already "compiled"
    expect(result.anchorSites).toHaveLength(0);
  });

  it("should handle dynamic ImportExpression in program visitor", () => {
    const code = `
      // zintl
      const load = () => import("./lazy");
    `;
    const result = extract(code, "test.ts", "test");
    expect(result.dependencies.some((d) => d.id.includes("lazy") && d.dynamic)).toBe(true);
  });

  it("should handle ExportNamedDeclaration with FunctionDeclaration", () => {
    const code = `
      export function ExportedFn() {
        return <h1>Exported</h1>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages.find((m) => m.text === "Exported")?.boundaryId).toBe("test:ExportedFn");
  });

  it("should handle FunctionExpression as a boundary", () => {
    const code = `
      const App = function() {
        return <h1>Expression</h1>;
      };
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages.find((m) => m.text === "Expression")?.boundaryId).toBe("test:App");
  });

  it("should detect manual t() calls as sinks for boundary creation", () => {
    const code = `
      function App() {
        return t("hello");
      }
    `;
    const result = extract(code, "test.ts", "test");
    expect(result.rawManualTranslations).toHaveLength(1);
    expect(result.rawManualTranslations[0].boundaryId).toBe("test:App");
  });

  it("should detect innerHTML assignments as sinks for boundary creation", () => {
    const code = `
      function App() {
        el.innerHTML = "Hello";
      }
    `;
    const result = extract(code, "test.ts", "test");
    expect(result.rawSinks).toHaveLength(1);
    expect(result.rawSinks[0].boundaryId).toBe("test:App");
  });
});
