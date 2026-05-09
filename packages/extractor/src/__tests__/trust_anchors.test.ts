import { describe, it, expect } from "vite-plus/test";
import { extract } from "../parser.js";

describe("Trust Anchors (zintl)", () => {
  it("should detect zintl at module level", () => {
    const code = `
      import { zintl } from "zintl";
      zintl("en");
      function App() { return <h1>Submit</h1>; }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.hasZintlMacro).toBe(true);
    expect(result.mode).toBe("entry");
    expect(result.anchorSites).toHaveLength(1);
    expect(result.anchorSites[0].scope).toBe("module");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Submit");
  });

  it("should detect zintl inside a function", () => {
    const code = `
      import { zintl } from "zintl";
      export function generateMetadata() {
        zintl("en");
        return { title: "My Page" };
      }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.hasZintlMacro).toBe(true);
    expect(result.mode).toBe("boundary");
    expect(result.anchorSites).toHaveLength(1);
    expect(result.anchorSites[0].scope).toBe("function");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("My Page");
    expect(result.messages[0].boundaryId).toBe("App:generateMetadata");
  });

  it("should handle multiple anchors in one file", () => {
    const code = `
      import { zintl } from "zintl";
      
      export function A() {
        zintl("en");
        return <h1>A</h1>;
      }

      export function B() {
        zintl("ar");
        return <h1>B</h1>;
      }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.anchorSites).toHaveLength(2);
    expect(result.messages).toHaveLength(2);

    const msgA = result.messages.find((m) => m.text === "A");
    const msgB = result.messages.find((m) => m.text === "B");

    expect(msgA?.boundaryId).toBe("App:A");
    expect(msgB?.boundaryId).toBe("App:B");
  });

  it("should still support zero-config module-level extraction", () => {
    const code = `
      export function UI() { return <div>UI</div>; }
    `;
    const result = extract(code, "UI.tsx", "UI");
    expect(result.hasZintlMacro).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].boundaryId).toBe("UI:UI");
  });
});
