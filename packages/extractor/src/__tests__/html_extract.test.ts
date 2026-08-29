import { extractBase as extract } from "./helpers/extract.js";
import { describe, it, expect } from "vite-plus/test";

describe("HTML Extraction", () => {
  it("should extract metadata from HTML", () => {
    const code = `
      <html>
      <head>
        <title>Test Title</title>
        <script type="module" src="/main.ts"></script>
      </head>
      <body>
        <div>Hello HTML!</div>
      </body>
      </html>
    `;
    const result = extract(code, "index.html", "index.html");
    expect(result.htmlProjection).toBeDefined();
    expect(result.htmlProjection?.title).toBe("Test Title");
    expect(result.htmlProjection?.scripts).toContain("/main.ts");

    const textMsg = result.messages.find((m) => m.text === "Hello HTML!");
    expect(textMsg).toBeDefined();
  });
});

/**
 * Found by building a documentation site — the first project in this repository
 * with paragraphs of prose in markup rather than one-line labels.
 */
describe("HTML text whitespace", () => {
  it("collapses a paragraph wrapped across source lines into one key", () => {
    const code = `
      <html>
      <body>
        <p>
          Released under the MIT licence, and every word of it
          was extracted from plain source.
        </p>
      </body>
      </html>
    `;
    const result = extract(code, "index.html", "index.html");
    const texts = result.messages.map((m) => m.text);

    // One key, one space at each break: what the browser renders, and what a
    // translator should be shown.
    expect(texts).toContain(
      "Released under the MIT licence, and every word of it was extracted from plain source.",
    );
    // The uncollapsed form ties the key to the author's indentation — reformat
    // the file and the translation is orphaned. It also lands a raw newline
    // inside the quoted literal codegen writes, which is a syntax error.
    expect(texts.some((t) => t.includes("\n"))).toBe(false);
  });

  it("leaves whitespace alone inside <pre>, where it is content", () => {
    const code = `
      <html>
      <body>
        <pre>line one
line two</pre>
      </body>
      </html>
    `;
    const result = extract(code, "index.html", "index.html");
    expect(result.messages.map((m) => m.text)).toContain("line one\nline two");
  });
});

/**
 * Also found by the documentation site — a table-of-contents component whose
 * root element was `<nav v-if="headings.length > 0" …>`.
 */
describe("HTML tag boundaries", () => {
  it("does not end a tag at a > inside a quoted attribute", () => {
    const code = `
      <html>
      <body>
        <nav v-if="count > 0" class="toc" aria-label="On this page">
          <span>Contents</span>
        </nav>
      </body>
      </html>
    `;
    const result = extract(code, "index.html", "index.html");
    const texts = result.messages.map((m) => m.text);

    expect(texts).toContain("Contents");
    // The remainder of the attribute list is markup, not prose. Extracting it
    // also rewrites it, which put a `_t(…)` call between two attributes.
    expect(texts.some((t) => t.includes("aria-label") || t.includes('class="toc"'))).toBe(false);
  });

  it("does not end a comment at a > inside it", () => {
    const code = `
      <html>
      <body>
        <!-- keep while count > 0 -->
        <p>Still here</p>
      </body>
      </html>
    `;
    const result = extract(code, "index.html", "index.html");
    const texts = result.messages.map((m) => m.text);

    expect(texts).toContain("Still here");
    expect(texts.some((t) => t.includes("keep while"))).toBe(false);
  });
});
