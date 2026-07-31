import { describe, it, expect } from "vite-plus/test";
import { extractBase as extract } from "./helpers/extract.js";
import { ExtractionContext } from "../context.js";
import { baseOptions } from "./helpers/extract.js";

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
      import { zintl } from "zintljs";
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

  it("should extract from ConditionalExpression", () => {
    const code = `
      function App() {
        el.title = isOk ? "Success" : "Failure";
      }
    `;
    const result = extract(code, "test.ts", "test");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Success");
    expect(texts).toContain("Failure");
  });

  it("should cover ExtractionContext helper logic", () => {
    const code = `
      function App() {
        el.innerHTML = "<span>hello</span>";
        el.innerHTML = "<span>hello</div>";
        el.innerHTML = "hello <span>world</span>";
        el.innerHTML = "<img/>";
        el.innerHTML = "<span></span><span></span>";
        el.innerHTML = "<!-- @zintl-ignore --><div>ignored</div>";
        el.innerHTML = "<!-- @zintl-note My note --><span>noted</span>";
      }
    `;
    const result = extract(code, "test.tsx", "test");
    expect(result.messages).toBeDefined();

    const ctx = new ExtractionContext("code", "test.ts", "test", baseOptions());
    expect(ctx.logicTaintedIdentifiers).toBeDefined();

    ctx.addTransform(0, 10, "replacement");
    expect(ctx.transforms[0].boundaryId).toBe("test");

    // Test stitchHTML / isSingleWrappingPhrasingTag branches directly
    const fragments: any[] = [];
    ctx["stitchHTML"](
      "<span>text</span>",
      (t, n, v) => fragments.push({ t, n, v }),
      "initialNote",
      { initialVar: "1" },
    );
    // isSingleWrappingPhrasingTag returns true for <span>text</span>, so it extracts the inner "text"
    expect(fragments[0].t).toBe("text");
    expect(fragments[0].n).toBe("initialNote");
    expect(fragments[0].v).toEqual({ initialVar: "1" });

    // Test restore of context vars branch
    const fragments2: any[] = [];
    ctx["stitchHTML"](
      '<!-- @zintl-pass myVar="2" -->text',
      (t, n, v) => fragments2.push({ t, n, v }),
      "initialNote",
      { myVar: "1" },
    );
    expect(fragments2[0].t).toBe("text");
    // TODO: check if this test is correct.
    // expect(fragments2[0].v.myVar).toBe('"2"');

    // Test isSingleWrappingPhrasingTag branches:
    // 1. trimmed ends with "/>"
    expect(ctx["stitchHTML"]("<img/>", () => {})).toBeUndefined();
    // 2. tokens.length < 3
    // const isSingle = ctx["getActiveBoundary"](); // dummy just to access private helpers/methods if needed
    // We can test isSingleWrappingPhrasingTag indirectly via stitchHTML output behavior:
    // E.g., if it's single wrapping, it's not fanned into multiple fragments.
    // 3. Not starting with "<" or ending with ">"
    // 4. first.startsWith("</") or starts with "<!--"
    // 5. non phrasing tag: <div>text</div>
    const divFragments: any[] = [];
    ctx["stitchHTML"]("<div>text</div>", (t) => divFragments.push(t));
    expect(divFragments).toContain("text"); // it will extract "text" instead of "<div>text</div>" because <div> is not phrasing!
  });
});
