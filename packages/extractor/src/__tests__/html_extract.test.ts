import { extract } from "../parser.js";
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
