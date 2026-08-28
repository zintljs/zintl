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

/**
 * Which element an HTML text node sat in.
 *
 * JSX has always reported this — the visitor holds the element — and HTML never
 * did: every text node arrived as one `sinkType`, so an `<h1>` and a `<p>` were
 * the same thing by the time anyone could show them to a translator. That made
 * proposal 032 §3's "this is an `aria-label`, not an `h1`" true for React and
 * false for every MPA. `stitchHTML` now tracks the open block elements.
 *
 * The field it lands in is the whole safety argument: `context`, never
 * `sinkType`. `sinkType` is how the pipeline splices a call back into the
 * document and is compared for equality against `"HTML_TEXT"` in the compiler,
 * so these tests assert it is *unchanged* as deliberately as they assert the
 * new value.
 */
describe("HTML text element context", () => {
  const sinks = (code: string) =>
    extract(code, "index.html", "index").rawSinks.filter((s) => s.sinkType === "HTML_TEXT");

  const byText = (code: string) => Object.fromEntries(sinks(code).map((s) => [s.text, s.context]));

  it("distinguishes a heading from a paragraph", () => {
    const found = byText(`<html><body><h1>A heading</h1><p>A paragraph</p></body></html>`);
    expect(found["A heading"]).toBe("h1");
    expect(found["A paragraph"]).toBe("p");
  });

  /**
   * `h1` is the reason the stack stores the raw tag name. `normalizeTags`
   * aliases *phrasing* tags with a trailing index, and the loop strips a
   * trailing digit to undo that — which takes `h1` to `h` for a tag that was
   * never aliased in the first place.
   */
  it("does not truncate a numbered heading to its letter", () => {
    const found = byText(`<html><body><h2>Second level</h2></body></html>`);
    expect(found["Second level"]).toBe("h2");
  });

  it("reports the block element rather than an inline wrapper", () => {
    const found = byText(
      `<html><body><p>Hello <b>there</b></p><li><em>Emphasised item</em></li></body></html>`,
    );
    // Stitched into one message across the inline tag, and reported as the
    // block it reads as rather than as the tag wrapping it.
    expect(found["Hello <b>there</b>"]).toBe("p");
    expect(found["Emphasised item"]).toBe("li");
  });

  /**
   * A void element must not open a frame.
   *
   * The text has to sit **after** the void tag and inside the same block for
   * this to mean anything. Put it before, or in a nested block, and the
   * unwinding close repairs the bad push before anything reads the stack — the
   * first version of this test was written that way and passed with `<hr>`
   * pushed, which is to say it tested nothing.
   */
  it("is not desynchronised by a void element", () => {
    const found = byText(`<html><body><div><hr>After the rule</div></body></html>`);
    expect(found["After the rule"]).toBe("div");
  });

  /**
   * Unwinding, not popping — and the difference only shows *after* the badly
   * closed region. A blind `pop()` on `</div>` removes the still-open `<p>` and
   * leaves `div` behind forever, so everything at the top level from then on is
   * attributed to a block that closed. The trailing text is what catches it.
   */
  it("unwinds to the match rather than mislabelling what follows", () => {
    const found = byText(
      `<html><body><div><p>Inside both</div><h2>After the mess</h2>Trailing text</body></html>`,
    );
    expect(found["Inside both"]).toBe("p");
    expect(found["After the mess"]).toBe("h2");
    // Top level, so no element — not the `div` a blind pop would have stranded.
    expect(found["Trailing text"]).toBeUndefined();
  });

  it("leaves sinkType alone, because the splice path reads it", () => {
    const all = sinks(`<html><body><h1>A heading</h1></body></html>`);
    expect(all).toHaveLength(1);
    expect(all[0].sinkType).toBe("HTML_TEXT");
    expect(all[0].context).toBe("h1");
  });

  /**
   * Context annotates a message; it never splits one (032 §8.1). Two elements
   * holding the same words stay one translatable unit.
   */
  it("does not split a message reached through two different elements", () => {
    const code = `<html><body><h1>Save</h1><p>Save</p></body></html>`;
    const result = extract(code, "index.html", "index");
    const save = result.messages.filter((m) => m.text === "Save");
    expect(save).toHaveLength(1);
    expect(save[0].contexts.slice().sort((a, b) => a.localeCompare(b))).toEqual(["h1", "p"]);
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
