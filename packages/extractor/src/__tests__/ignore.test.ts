import { describe, it, expect } from "vite-plus/test";
import { parseSync } from "oxc-parser";
import { ExtractionContext } from "../context.js";
import { baseOptions } from "./helpers/extract.js";
import { createCombinedVisitor } from "../visitors/index.js";
import { walk } from "../walker.js";

describe("Zintl Ignore Directives", () => {
  function runExtractor(code: string) {
    const ctx = new ExtractionContext(code, "test.tsx", "test", baseOptions());
    const result = parseSync("test.tsx", code);
    const trivias = (result as any).comments || (result as any).trivias || [];
    ctx.trivias = trivias;
    const visitor = createCombinedVisitor(ctx);
    walk(result.program, visitor, ctx);
    return ctx;
  }

  it("should ignore entire file with @zintl-ignore-file", () => {
    const code = `
      // @zintl-ignore-file
      import { zintl } from "zintljs";
      const x = zintl("en");
      const label = "Translate me";
      function App() {
        return <div>Visible</div>;
      }
    `;
    const ctx = runExtractor(code);
    expect(ctx.messages).toHaveLength(0);
  });

  it("should ignore specific JSX element and its subtree", () => {
    const code = `
      function App() {
        return (
          <div>
            {/* @zintl-ignore */}
            <div>
              <span>Hidden</span>
              <button>Also Hidden</button>
            </div>
            <span>Visible</span>
          </div>
        );
      }
    `;
    const ctx = runExtractor(code);
    const texts = Array.from(ctx.messages.values()).map((m) => m.text);
    expect(texts).not.toContain("Hidden");
    expect(texts).not.toContain("Also Hidden");
    expect(texts).toContain("Visible");
  });

  it("should ignore specific JSX attribute", () => {
    const code = `
      function App() {
        return (
          <button
            // @zintl-ignore
            aria-label="Ignored"
            title="Visible"
          >
            Click
          </button>
        );
      }
    `;
    const ctx = runExtractor(code);
    const contexts = Array.from(ctx.messages.values()).flatMap((m) => m.contexts);
    expect(contexts).not.toContain("aria-label");
    expect(contexts).toContain("title");
    expect(contexts).toContain("button"); // for child text "Click"
  });

  it("should ignore specific object property", () => {
    const code = `
      const config = {
        // @zintl-ignore
        label: "Ignored",
        description: "Visible"
      };
    `;
    const ctx = runExtractor(code);
    const texts = Array.from(ctx.messages.values()).map((m) => m.text);
    expect(texts).not.toContain("Ignored");
    expect(texts).toContain("Visible");
  });

  it("should ignore full function", () => {
    const code = `
      // @zintl-ignore
      function IgnoredComponent() {
        return <div>Hidden</div>;
      }
      function VisibleComponent() {
        return <div>Visible</div>;
      }
    `;
    const ctx = runExtractor(code);
    const texts = Array.from(ctx.messages.values()).map((m) => m.text);
    expect(texts).not.toContain("Hidden");
    expect(texts).toContain("Visible");
  });

  it("should handle multiple attributes on one line with surgical ignore", () => {
    // This is a tricky case: does the comment apply to the whole line or just the next attribute?
    // Standard behavior is usually the next node.
    const code = `
       <input 
         /* @zintl-ignore */ placeholder="Hidden" 
         title="Visible" 
       />
     `;
    const ctx = runExtractor(code);
    const texts = Array.from(ctx.messages.values()).map((m) => m.text);
    expect(texts).not.toContain("Hidden");
    expect(texts).toContain("Visible");
  });

  it("should handle block-level ignore in HTML fragmentation", () => {
    const code = `
      element.innerHTML = \`
        <!-- @zintl-ignore -->
        <div class="locale-switcher">
          <button data-locale="en">English</button>
          <button data-locale="ar">العربية</button>
        </div>
        <span>Visible</span>
      \`;
    `;
    const ctx = runExtractor(code);
    const texts = Array.from(ctx.messages.values()).map((m) => m.text);
    expect(texts).not.toContain("English");
    expect(texts).not.toContain("العربية");
    expect(texts).toContain("Visible");
  });
});
