import { describe, it, expect } from "vite-plus/test";
import { extract } from "../parser.js";

describe("Semantic Context Extraction", () => {
  it("should generate one ID for same text in different tags", () => {
    const code = `function App() { return <div><h1>Submit</h1><button>Submit</button></div>; }`;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("Submit");
  });

  it("should generate one ID for same text in different attributes and keep track the contexts", () => {
    const code = `function App() { return <img title="Close" alt="Close" />; }`;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages[0].contexts).toHaveLength(2);
    expect(result.messages[0].contexts[0]).toBe("title");
    expect(result.messages[0].contexts[1]).toBe("alt");
  });
});

describe("Function-Level Boundaries", () => {
  it("should support function-level trust anchors", () => {
    const code = `
      import { zintl } from "zintl";
      function Auth() {
        zintl("en");
        return <div>Login</div>;
      }
      function Home() {
        return <div>Welcome</div>;
      }
    `;
    const result = extract(code, "App.tsx", "App");
    expect(result.messages).toHaveLength(2);
    const authMsg = result.messages.find((m) => m.text === "Login")!;
    const homeMsg = result.messages.find((m) => m.text === "Welcome")!;

    expect(authMsg.boundaryId).toContain("App:Auth");
    expect(homeMsg.boundaryId).toBe("App:Home");
  });
});

describe("Complex Expression Sinks", () => {
  it("should extract literals from ObjectExpression sinks", () => {
    const code = `
      function App() {
        el.title = {
          text: "Title",
          meta: { desc: "Description" }
        };
      }
    `;
    const result = extract(code, "test.ts", "test");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Title");
    expect(texts).toContain("Description");
    expect(result.messages.find((m) => m.text === "Title")?.contexts).toContain("text");
    expect(result.messages.find((m) => m.text === "Description")?.contexts).toContain("meta.desc");
  });

  it("should extract literals from BinaryExpression and LogicalExpression sinks", () => {
    const code = `
      function App() {
        el.innerHTML = "Hello " + "World";
        el.ariaLabel = user.name || "Guest";
      }
    `;
    const result = extract(code, "test.ts", "test");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Hello ");
    expect(texts).toContain("World");
    expect(texts).toContain("Guest");
  });
});

describe("File-Level Ignore", () => {
  it("should ignore entire file with @zintl-ignore-file", () => {
    const code = `
      // @zintl-ignore-file
      function App() {
        return <div>Visible</div>;
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages).toHaveLength(0);
  });
});
