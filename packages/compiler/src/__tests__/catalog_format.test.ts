import { describe, it, expect } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";

describe("ZintlCompiler - getCatalogPath Configurations", () => {
  const root = "/project";

  it("should use default format when catalogFormat is not provided", () => {
    const compiler = new ZintlCompiler({ outputDir: "locales" }, root, true);

    // Normal file
    expect(compiler.getCatalogPath("src/components/App", "en")).toBe(
      join(root, "locales", "src/components/App.en.json"),
    );

    // SvelteKit route
    expect(compiler.getCatalogPath("src/routes/+page", "ar")).toBe(
      join(root, "locales", "src/routes/+page.ar.json"),
    );

    // Function boundary
    expect(compiler.getCatalogPath("src/components/App:myFunction", "en")).toBe(
      join(root, "locales", "src/components/App.myFunction.en.json"),
    );
  });

  it("should process custom string templates correctly", () => {
    // We mock the getBoundaryId via a spy or just rely on its internal sha1 behavior in dev/prod
    const compiler = new ZintlCompiler(
      {
        outputDir: "i18n",
        catalogFormat: "[locale]/[dir]/[name]-[func].json",
      },
      root,
      true,
    ); // Dev mode returns path as hash

    expect(compiler.getCatalogPath("src/components/Button:click", "en")).toBe(
      join(root, "i18n", "en/src/components/Button-click.json"),
    );

    // With SvelteKit, path cleanups
    expect(compiler.getCatalogPath("src/routes/+page", "en")).toBe(
      join(root, "i18n", "en/src/routes/+page.json"), // missing [func] removes dangling dash correctly
    );
  });

  it("should process deep mirror string templates", () => {
    const compiler = new ZintlCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[locale]/[path].json",
      },
      root,
      true,
    );

    expect(compiler.getCatalogPath("src/components/Header", "ar")).toBe(
      join(root, "locales", "ar/src/components/Header.json"),
    );
  });

  it("should support function based catalogFormat", () => {
    const compiler = new ZintlCompiler(
      {
        outputDir: "locales",
        catalogFormat: (ctx) => {
          return `custom/${ctx.locale}/${ctx.name}${ctx.func ? `_${ctx.func}` : ""}.json`;
        },
      },
      root,
      true,
    );

    expect(compiler.getCatalogPath("src/components/Header", "en")).toBe(
      join(root, "locales", "custom/en/Header.json"),
    );

    expect(compiler.getCatalogPath("src/components/Header:init", "en")).toBe(
      join(root, "locales", "custom/en/Header_init.json"),
    );
  });

  it("should use short hash for [hash] token", () => {
    const compiler = new ZintlCompiler(
      {
        outputDir: "dist-locales",
        catalogFormat: "[locale]/[hash].json",
      },
      root,
      false,
    ); // Prod mode uses hash instead of path for stable ID

    // Hash is derived from boundaryId "src/ui/Card"
    const path = compiler.getCatalogPath("src/ui/Card", "en");
    expect(path).toContain("dist-locales/en/");
    expect(path).not.toContain("src/ui/Card");
    expect(path?.endsWith(".json")).toBe(true);
  });

  it("should generate proper schema paths within .schemas directory", () => {
    const compiler = new ZintlCompiler(
      {
        outputDir: "locales",
        catalogFormat: "[locale]/[dir]/[name]-[func].json",
      },
      root,
      true,
    );

    const schemaPath = compiler.getSchemaPath("src/components/Button:click");
    // [locale] gives "", [dir] gives "src/components", [name] gives "Button", [func] gives "click"
    // Leading slash removed, lands in .schemas/
    expect(schemaPath).toBe(
      join(root, "locales", ".schemas", "src/components/Button-click.schema.json"),
    );

    // Default formatter
    const defaultCompiler = new ZintlCompiler({ outputDir: "locales" }, root, true);
    expect(defaultCompiler.getSchemaPath("src/components/App")).toBe(
      join(root, "locales", ".schemas", "src/components/App.schema.json"),
    );
  });
});
