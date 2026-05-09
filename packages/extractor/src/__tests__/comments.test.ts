import { describe, it, expect } from "vite-plus/test";
import { parseSync } from "oxc-parser";
import { parseZintlComments } from "../comments.js";
import { ExtractionContext } from "../context.js";
import { createCombinedVisitor } from "../visitors/index.js";
import { walk } from "../walker.js";

describe("parseZintlComments (Unit)", () => {
  it("should detect @zintl-ignore", () => {
    const code = "// @zintl-ignore\nconst x = 1;";
    const trivias = [{ value: " @zintl-ignore ", end: 16, start: 0, kind: "Line" }] as any;
    const result = parseZintlComments(17, trivias, code);
    expect(result.ignore).toBe(true);
  });

  it("should extract @zintl-note", () => {
    const code = "// @zintl-note Important\nconst x = 1;";
    const trivias = [{ value: " @zintl-note Important ", end: 24, start: 0, kind: "Line" }] as any;
    const result = parseZintlComments(25, trivias, code);
    expect(result.note).toBe("Important");
  });

  it("should extract @zintl-pass variables", () => {
    const code = "// @zintl-pass role=admin\nconst x = 1;";
    const trivias = [{ value: " @zintl-pass role=admin ", end: 25, start: 0, kind: "Line" }] as any;
    const result = parseZintlComments(26, trivias, code);
    expect(result.contextVars.role).toBe('"admin"');
  });

  it("should fail proximity check if there is intervening code", () => {
    const code = "// @zintl-ignore\nconst y = 2;\nconst x = 1;";
    const trivias = [{ value: " @zintl-ignore ", end: 16, start: 0, kind: "Line" }] as any;
    // node starts at x (index 29)
    const result = parseZintlComments(29, trivias, code);
    expect(result.ignore).toBe(false); // Should be false because "const y = 2;" is between them
  });

  it("should ignore comments that start after the node", () => {
    const code = "const x = 1; // @zintl-ignore";
    const trivias = [{ value: "@zintl-ignore", end: 29, start: 13, kind: "Line" }] as any;
    const result = parseZintlComments(0, trivias, code);
    expect(result.ignore).toBe(false);
  });
});

describe("Zintl Directives (Integration)", () => {
  function runExtractor(code: string) {
    const ctx = new ExtractionContext(code, "test.tsx", "test");
    const result = parseSync("test.tsx", code);
    const trivias = (result as any).comments || (result as any).trivias || [];
    ctx.trivias = trivias;
    const visitor = createCombinedVisitor(ctx);
    walk(result.program, visitor, ctx);
    return ctx;
  }

  it("should suppress extraction with @zintl-ignore in JSX", () => {
    const code = `
      const App = () => (
        <div>
          <div>
            {/* @zintl-ignore */}
            <h1>Hidden</h1>
          </div>
          <div>
            <p>Visible</p>
          </div>
        </div>
      );
    `;
    const ctx = runExtractor(code);
    const messages = Array.from(ctx.messages.values());
    expect(messages.map((m) => m.text)).not.toContain("Hidden");
    expect(messages.map((m) => m.text)).toContain("Visible");
  });

  it("should attach @zintl-note to a JSX element", () => {
    const code = `
      const App = () => (
        <div>
          {/* @zintl-note Instructions for translator */}
          <h1>Instructional text</h1>
        </div>
      );
    `;
    const ctx = runExtractor(code);
    const msg = Array.from(ctx.messages.values()).find((m) => m.text === "Instructional text");
    expect(msg?.note).toBe("Instructions for translator");
  });

  it("should attach @zintl-pass variables to a JSX element", () => {
    const code = `
      const App = () => (
        <div>
          {/* @zintl-pass gender=female status={user.active} */}
          <h1>Status message</h1>
        </div>
      );
    `;
    const ctx = runExtractor(code);
    const msg = Array.from(ctx.messages.values()).find((m) => m.text === "Status message");
    expect(msg?.passVars).toEqual({
      gender: '"female"',
      status: "user.active",
    });
  });

  it("should handle multiple directives in one JSX comment", () => {
    const code = `
      const App = () => (
        <div>
          {/* @zintl-note Note here @zintl-pass role=admin */}
          <h1>Multi directive</h1>
        </div>
      );
    `;
    const ctx = runExtractor(code);
    const msg = Array.from(ctx.messages.values()).find((m) => m.text === "Multi directive");
    expect(msg?.note).toBe("Note here");
    expect(msg?.passVars?.role).toBe('"admin"');
  });

  it("should extract pass variables with different quoting styles", () => {
    const code = `
      const App = () => (
        <div>
          {/* @zintl-pass double="val" single='val' expression={expr} unquoted=val num=123 bool=true */}
          <h1>Complex Quoting</h1>
        </div>
      );
    `;
    const ctx = runExtractor(code);
    const msg = Array.from(ctx.messages.values()).find((m) => m.text === "Complex Quoting");
    expect(msg?.passVars).toEqual({
      double: '"val"',
      single: "'val'",
      expression: "expr",
      unquoted: '"val"',
      num: "123",
      bool: "true",
    });
  });
});

import { parseHTMLDirectives } from "../comments.js";

describe("parseHTMLDirectives", () => {
  it("should extract directives from HTML comments", () => {
    const html = "<!-- @zintl-note HTML Note @zintl-pass role=admin @zintl-ignore -->";
    const result = parseHTMLDirectives(html);
    expect(result.note).toBe("HTML Note");
    expect(result.contextVars.role).toBe('"admin"');
    expect(result.ignore).toBe(true);
  });

  it("should handle complex quoting in HTML directives", () => {
    const html = "<!-- @zintl-pass a=\"double\" b='single' c={exp} d=unquoted e=123 f=false -->";
    const result = parseHTMLDirectives(html);
    expect(result.contextVars).toEqual({
      a: '"double"',
      b: "'single'",
      c: "exp",
      d: '"unquoted"',
      e: "123",
      f: "false",
    });
  });

  it("should return empty result if no directives present", () => {
    const html = "<!-- just a comment -->";
    const result = parseHTMLDirectives(html);
    expect(result.ignore).toBe(false);
    expect(result.note).toBeUndefined();
    expect(Object.keys(result.contextVars)).toHaveLength(0);
  });
});
