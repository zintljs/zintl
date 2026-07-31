import { describe, it, expect } from "vite-plus/test";
import { extractBase as extract } from "./helpers/extract.js";

describe("Zintl Extractor", () => {
  it("should extract JSX text", () => {
    const code = `
      function App() { return <h1>Submit</h1>; }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Submit");
  });

  it("should extract accessibility attributes", () => {
    const code = `
      function App() { return <button aria-label="Close" /> }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Close");
  });

  it("should extract UI object fields", () => {
    const code = `
      const config = { label: "Username" };
      function App() { return <h1>{config.label}</h1>; }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages[0].text).toBe("Username");
  });

  it("should handle zero-config module-level extraction", () => {
    const code = `
      function App() { return <h1>Submit</h1>; }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Submit");
  });

  it("should normalize variables with member expressions in JSX", () => {
    const code = `
      function App({ user }) { return <h1>Welcome, {user.name}</h1>; }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages[0].text).toBe("Welcome, {user_name}");
  });

  it("should handle mixed templates and expressions correctly", () => {
    const code = `
      function App() {
        const status = "success";
        return <div className={\`status-\${status}\`}>Result: {status}</div>;
      }
    `;
    const result = extract(code, "App.tsx", "App");
    // status is not a UI sink, so standard extraction doesn't catch it unless logic says so.
    // However, the inner content 'Result: {status}' should be caught.
    const msg = result.messages.find((m) => m.text.includes("Result"));
    expect(msg).toBeDefined();
    expect(msg?.text).toBe("Result: {status}");
  });

  it("should avoid variable collisions during normalization", () => {
    const code = `
      const input = "test";
      const res = \`Value: \${input} and \${"other"}\`;
      // In Zintl, template literals at module level might not be extracted unless assigned to sink.
      const config = { label: \`Value: \${input} and \${"other"}\` };
    `;
    const result = extract(code, "App.tsx", "App");
    const msg = result.messages.find((m) => m.text.startsWith("Value"));
    expect(msg?.text).toBe("Value: {input} and {input2}");
  });

  it("should return empty result for non-UI file (heuristic skip)", () => {
    const code = "const x = 1 + 2;";
    const result = extract(code, "test.ts", "test");
    expect(result.messages).toHaveLength(0);
    expect(result.hasZintlMacro).toBe(false);
  });

  it("should capture internal dependencies between boundaries", () => {
    const code = `
      function Inner() {
        return <h1>Inner</h1>;
      }
      export function Outer() {
        Inner();
        return <h1>Outer</h1>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.internalDeps["test:Outer"]).toContain("test:Inner");
  });

  it("should recursively trace variable declarations for anchor detection", () => {
    const code = `
      import { zintl } from "zintljs";
      const a = "en";
      const b = a;
      const c = b;
      zintl(c);
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.hasZintlMacro).toBe(true);
    const site = result.anchorSites[0];
    expect(site.detectionCode).toContain('const a = "en";');
    expect(site.detectionCode).toContain("const b = a;");
    expect(site.detectionCode).toContain("const c = b;");
  });

  it("should register exports and default exports in non-UI files (fast path)", () => {
    const code = `
      import { other } from "./other";
      export function helper() {}
      export const arrow = () => {};
      export default function() {}
    `;
    const result = extract(code, "Helper.ts", "Helper");
    expect(result.exportedBoundaries["helper"]).toBe("Helper:helper");
    expect(result.exportedBoundaries["arrow"]).toBe("Helper:arrow");
    expect(result.exportedBoundaries["default"]).toBe("Helper:default");
  });

  it("should handle default import specifiers", () => {
    const code = `
      import zintl from "zintljs";
      zintl("en");
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.hasZintlMacro).toBe(true);
  });

  it("should capture statementRange correctly in ReturnStatement", () => {
    const code = `
      import { zintl } from "zintljs";
      function App() {
        return zintl("en");
      }
    `;
    const result = extract(code, "App.tsx", "App");
    const site = result.anchorSites[0];
    expect(site.statementRange).toBeDefined();
  });

  it("should extract html dir attribute", () => {
    const code = `
      function App() {
        return <html dir="ltr" />
      }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("ltr");
    expect(result.messages[0].contexts).toContain("dir");
  });
});
