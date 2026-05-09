import { describe, it, expect } from "vite-plus/test";
import { extract } from "../../parser.js";

describe("createJsxVisitor (Integration)", () => {
  it("should extract simple JSXText", () => {
    const code = `
      function App() {
        return <div>Hello World</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Hello World");
    expect(result.messages[0].contexts).toContain("div");
  });

  it("should extract JSXAttribute for UI attributes", () => {
    const code = `
      function App() {
        return <input placeholder="Enter name" title="Name Field" />;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    // Should extract placeholder and title
    expect(result.messages.map((m) => m.text)).toContain("Enter name");
    expect(result.messages.map((m) => m.text)).toContain("Name Field");
  });

  it("should stitch JSX children with expressions", () => {
    const code = `
      function App({ name }) {
        return <div>Hello {name}! Welcome.</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Hello {name}! Welcome.");
    expect(result.messages[0].variables).toContain("name");
  });

  it("should handle JSXExpressionContainer with template literals", () => {
    const code = `
      function App({ count }) {
        return <div>{ \`Items: \${count}\` }</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Items: {count}");
  });

  it("should handle JSX comments with directives", () => {
    const code = `
      function App() {
        return (
          <div>
            {/* @zintl-ignore */}
            <span>Ignored</span>
            {/* @zintl-note: Context for visible */}
            <span>Visible</span>
          </div>
        );
      }
    `;
    const result = extract(code, "test.tsx", "test");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Visible");
    expect(texts).not.toContain("Ignored");
    expect(result.messages.find((m) => m.text === "Visible")?.note).toBe("Context for visible");
  });

  it("should handle @zintl-pass in JSX", () => {
    const code = `
      function App() {
        return (
          // @zintl-pass x=y
          <div>Hello User</div>
        );
      }
    `;
    const result = extract(code, "test.tsx", "test");
    const msg = result.messages.find((m) => m.text === "Hello User");
    expect(msg?.passVars?.x).toBeDefined();
  });

  it("should handle complex MemberExpressions in JSX children", () => {
    const code = `
      function App({ user }) {
        return <div>Welcome { user.profile.name }</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages[0].text).toBe("Welcome {user_profile_name}");
    expect(result.messages[0].variables).toContain("user_profile_name");
  });

  it("should handle Fragment stitching", () => {
    const code = `
      function App() {
        return <>Mixed <b>bold</b> text</>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    // b bold /b should be a separate boundary or handled by JSXText?
    // In processJsxChildren, if there are JSXElement children, it returns early.
    // So <b>bold</b> is handled by its own visitor, and "Mixed" and " text" are handled by JSXText visitor.
    expect(result.messages.map((m) => m.text)).toContain("Mixed");
    expect(result.messages.map((m) => m.text)).toContain("bold");
    expect(result.messages.map((m) => m.text)).toContain("text");
  });

  it("should handle JSXAttribute with @zintl-ignore", () => {
    const code = `
      function App() {
        return <input 
          // @zintl-ignore
          placeholder="Ignored" 
          title="Visible" 
        />;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Visible");
    expect(texts).not.toContain("Ignored");
  });

  it("should handle unnamed expressions in JSX children", () => {
    const code = `
      function App() {
        return <div>Value: { 1 + 1 }</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages[0].text).toBe("Value: {input}");
    expect(result.messages[0].variables).toContain("input");
  });

  it("should handle complex MemberExpressions in JSX with fallback to last part", () => {
    const code = `
      function App() {
        return <div>Value: { (func()).name }</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages[0].text).toBe("Value: {name}");
  });

  it("should respect @zintl-ignore on JSXElement and JSXFragment", () => {
    const code = `
      function App() {
        return (
          <div>
            {/* @zintl-ignore */}
            <span title="Ignored">Ignored</span>
            
            {/* @zintl-ignore */}
            <>
              <span title="Fragment Ignored">Fragment Ignored</span>
            </>
          </div>
        );
      }
    `;
    const result = extract(code, "test.tsx", "test");
    const texts = result.messages.map((m) => m.text);
    expect(texts).not.toContain("Ignored");
    expect(texts).not.toContain("Fragment Ignored");
  });

  it("should handle @zintl-ignore on JSXElement in assignment", () => {
    const code = `
      function App() {
        const x = /* @zintl-ignore */ <span title="Ignored">Ignored</span>;
        const y = /* @zintl-ignore */ <><span title="Ignored">Ignored</span></>;
        return <div>{x}{y}</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages.map((m) => m.text)).not.toContain("Ignored");
  });
});
