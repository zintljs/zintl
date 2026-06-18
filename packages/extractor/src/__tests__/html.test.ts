import { describe, it, expect } from "vite-plus/test";
import { extract } from "../parser.js";

describe("HTML Extraction", () => {
  it("should extract title and description from HTML", () => {
    const code = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>My App</title>
        <meta name="description" content="A modern platform">
      </head>
      <body></body>
      </html>
    `;
    const result = extract(code, "index.html", "index");

    expect(result.htmlProjection).toBeDefined();
    expect(result.htmlProjection?.title).toBe("My App");
    expect(result.htmlProjection?.description).toBe("A modern platform");
  });

  it("should extract module scripts", () => {
    const code = `
      <html>
      <head>
        <script type="module" src="/src/main.ts"></script>
        <script src="/legacy.js"></script>
        <script src="/src/other.ts" type="module"></script>
      </head>
      </html>
    `;
    const result = extract(code, "index.html", "index");

    expect(result.htmlProjection?.scripts).toContain("/src/main.ts");
    expect(result.htmlProjection?.scripts).toContain("/src/other.ts");
    expect(result.htmlProjection?.scripts).toContain("/legacy.js");
    expect(result.dependencies.map((d) => d.id)).toContain("/src/main.ts");
  });

  it("should handle missing title or description", () => {
    const code = `<html><head></head></html>`;
    const result = extract(code, "index.html", "index");

    expect(result.htmlProjection?.title).toBeUndefined();
    expect(result.htmlProjection?.description).toBeUndefined();
  });
  it("should handle dir for source locale in case it is rtl locale", () => {
    const code = `
      <html dir="rtl">
      <head>
        <script type="module" src="/src/main.ts"></script>
      </head>
      </html>
    `;
    const result = extract(code, "index.html", "index");

    expect(result.htmlProjection?.dir).toBe("rtl");
  });
});
