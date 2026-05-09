import { describe, it, expect } from "vite-plus/test";
import { parseSync } from "oxc-parser";
import { ExtractionContext } from "../../context.js";
import { createCombinedVisitor } from "../../visitors/index.js";
import { createBindingVisitor } from "../../visitors/bindings.js";
import { walk } from "../../walker.js";

// ─── Test Helper ─────────────────────────────────────────────────────────────

/**
 * Parse code with oxc-parser and walk the AST through the given visitor.
 * Uses createBindingVisitor by default, or createCombinedVisitor when needed.
 */
function runBindingVisitor(
  code: string,
  filePath: string,
  fileBoundaryId: string,
  options: { combined?: boolean; contextOptions?: Record<string, any> } = {},
) {
  const ctx = new ExtractionContext(code, filePath, fileBoundaryId, options.contextOptions);
  const result = parseSync(filePath, code);
  ctx.trivias = (result as any).comments || (result as any).trivias || [];

  const visitor = (
    options.combined ? createCombinedVisitor(ctx) : createBindingVisitor(ctx)
  ) as any;
  walk(result.program, visitor, ctx);
  return ctx;
}

// ─── §1: Import Resolution (resolveBoundaryId) ────────────────────────────────

describe("resolveBoundaryId — relative import resolution", () => {
  it("resolves a same-level relative import", () => {
    const ctx = runBindingVisitor(`import { foo } from "./utils";`, "src/main.ts", "src/main");
    expect(ctx.dependencyPaths.has("src/utils")).toBe(true);
    expect(ctx.dependencyPaths.get("src/utils")).toBe(false); // static
  });

  it("resolves a parent-level relative import (one level up)", () => {
    const ctx = runBindingVisitor(
      `import { bar } from "../components/common";`,
      "src/feature/index.ts",
      "src/feature/index",
    );
    expect(ctx.dependencyPaths.has("src/components/common")).toBe(true);
  });

  it("resolves a parent-level relative import (two levels up)", () => {
    const ctx = runBindingVisitor(
      `import { x } from "../../lib/helper";`,
      "src/feature/alpha/index.ts",
      "src/feature/alpha/index",
    );
    expect(ctx.dependencyPaths.has("src/lib/helper")).toBe(true);
  });

  it("strips known source extensions from resolved path", () => {
    const ctx = runBindingVisitor(`import { x } from "./util.ts";`, "src/main.ts", "src/main");
    expect(ctx.dependencyPaths.has("src/util")).toBe(true);
    expect(ctx.dependencyPaths.has("src/util.ts")).toBe(false);
  });

  it("ignores CSS imports", () => {
    const ctx = runBindingVisitor(`import "./styles.css";`, "src/main.ts", "src/main");
    expect(Array.from(ctx.dependencyPaths.keys())).toHaveLength(0);
  });

  it("ignores SVG imports", () => {
    const ctx = runBindingVisitor(`import logo from "./logo.svg";`, "src/main.ts", "src/main");
    expect(Array.from(ctx.dependencyPaths.keys())).toHaveLength(0);
  });

  it("ignores image imports (png, jpg, webp, gif)", () => {
    const code = `
      import a from "./a.png";
      import b from "./b.jpg";
      import c from "./c.webp";
      import d from "./d.gif";
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(Array.from(ctx.dependencyPaths.keys())).toHaveLength(0);
  });

  it("ignores font imports (woff, woff2, ttf)", () => {
    const code = `
      import a from "./font.woff";
      import b from "./font.woff2";
      import c from "./font.ttf";
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(Array.from(ctx.dependencyPaths.keys())).toHaveLength(0);
  });

  it("ignores non-relative bare specifiers", () => {
    const ctx = runBindingVisitor(`import { something } from "lodash";`, "src/main.ts", "src/main");
    expect(Array.from(ctx.dependencyPaths.keys())).toHaveLength(0);
  });

  it("resolves multiple imports in one file", () => {
    const code = `
      import { foo } from "./utils";
      import { bar } from "../components/common";
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.dependencyPaths.has("src/utils")).toBe(true);
    // join("src", "../components/common") -> "components/common"
    expect(ctx.dependencyPaths.has("components/common")).toBe(true);
  });

  it("resolves path when fileBoundaryId has no directory segment", () => {
    const ctx = runBindingVisitor(`import { x } from "./helper";`, "main.ts", "main");
    expect(ctx.dependencyPaths.has("helper")).toBe(true);
  });
});

// ─── §2: Runtime Package Imports ─────────────────────────────────────────────

describe("ImportDeclaration — runtime package tracking", () => {
  it("records named specifiers from the runtime package", () => {
    const ctx = runBindingVisitor(`import { t, zintl } from "zintl";`, "src/main.ts", "src/main");
    expect(ctx.runtimeImports).toContain("t");
    expect(ctx.runtimeImports).toContain("zintl");
  });

  it("ignores default imports from the runtime package", () => {
    const ctx = runBindingVisitor(`import zintl from "zintl";`, "src/main.ts", "src/main");
    // default specifier is not an ImportSpecifier, should not be pushed
    expect(ctx.runtimeImports).toHaveLength(0);
  });

  it("does not record specifiers from other packages", () => {
    const ctx = runBindingVisitor(`import { t } from "some-other-lib";`, "src/main.ts", "src/main");
    expect(ctx.runtimeImports).toHaveLength(0);
  });

  it("respects custom runtimePackage option", () => {
    const ctx = runBindingVisitor(`import { t } from "@myorg/i18n";`, "src/main.ts", "src/main", {
      contextOptions: { runtimePackage: "@myorg/i18n" },
    });
    expect(ctx.runtimeImports).toContain("t");
  });
});

// ─── §3: Dynamic Imports (ImportExpression) ───────────────────────────────────

describe("ImportExpression — dynamic import tracking", () => {
  it("marks dynamic imports as dynamic (true)", () => {
    const ctx = runBindingVisitor(`const load = () => import("./lazy-module");`, "main.ts", "main");
    expect(ctx.dependencyPaths.get("lazy-module")).toBe(true);
  });

  it("static import wins over dynamic import for the same path", () => {
    const code = `
      import "./module";
      const load = () => import("./module");
    `;
    const ctx = runBindingVisitor(code, "main.ts", "main");
    expect(ctx.dependencyPaths.get("module")).toBe(false); // static wins
  });

  it("dynamic import does not overwrite existing static entry", () => {
    // Dynamic comes first in source order
    const code = `
      const load = () => import("./shared");
      import "./shared";
    `;
    const ctx = runBindingVisitor(code, "main.ts", "main");
    // static import sets it to false; dynamic should not overwrite because
    // ImportExpression handler checks has() before setting
    // Note: static runs as ImportDeclaration which always sets unconditionally,
    // so regardless of order, static (false) should be the final value.
    expect(ctx.dependencyPaths.get("shared")).toBe(false);
  });

  it("ignores dynamic imports of non-relative paths", () => {
    const ctx = runBindingVisitor(`const load = () => import("some-package");`, "main.ts", "main");
    expect(Array.from(ctx.dependencyPaths.keys())).toHaveLength(0);
  });

  it("resolves dynamic import path correctly relative to file", () => {
    const ctx = runBindingVisitor(
      `const load = () => import("../pages/home");`,
      "src/router/index.ts",
      "src/router/index",
    );
    expect(ctx.dependencyPaths.get("src/pages/home")).toBe(true);
  });
});

// ─── §4: AssignmentExpression Sinks ──────────────────────────────────────────

describe("AssignmentExpression — UI sink detection", () => {
  it("detects innerHTML assignment as a sink", () => {
    const code = `el.innerHTML = "Hello World";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(1);
    expect(ctx.rawSinks[0].sinkType).toBe("innerHTML");
    expect(ctx.rawSinks[0].text).toBe("Hello World");
  });

  it("detects title assignment as a sink", () => {
    const code = `document.title = "Page Title";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(1);
    expect(ctx.rawSinks[0].sinkType).toBe("title");
  });

  it("detects aria-label assignment via ariaLabel", () => {
    const code = `btn.ariaLabel = "Close dialog";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(1);
    expect(ctx.rawSinks[0].sinkType).toBe("ariaLabel");
  });

  it("ignores assignments to non-UI properties", () => {
    const code = `obj.someRandomProp = "not a sink";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(0);
  });

  it("ignores non-MemberExpression left-hand sides", () => {
    const code = `const x = "Hello";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(0);
  });

  it("registers the message in ctx.messages", () => {
    const code = `el.innerHTML = "Translate me";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.messages.size).toBe(1);
    const msg = Array.from(ctx.messages.values())[0];
    expect(msg.text).toBe("Translate me");
    expect(msg.sinkTypes[0]).toBe("innerHTML");
  });

  it("produces a stable message id deterministically", () => {
    const code = `el.innerHTML = "Hello";`;
    const ctx1 = runBindingVisitor(code, "src/main.ts", "src/main");
    const ctx2 = runBindingVisitor(code, "src/main.ts", "src/main");
    const msg1 = Array.from(ctx1.messages.values())[0];
    const msg2 = Array.from(ctx2.messages.values())[0];
    expect(msg1.id).toBe(msg2.id);
  });

  it("handles multiple sink assignments in one file", () => {
    const code = `
      el.innerHTML = "First";
      el.title = "Second";
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(2);
    expect(ctx.rawSinks.map((s) => s.text)).toEqual(expect.arrayContaining(["First", "Second"]));
  });
});

// ─── §5: Property Sinks ───────────────────────────────────────────────────────

describe("Property — UI object field sink detection", () => {
  it("detects a translatable property in an object literal", () => {
    const code = `
      const props = {
        title: "My Title",
      };
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(1);
    expect(ctx.rawSinks[0].sinkType).toBe("title");
    expect(ctx.rawSinks[0].text).toBe("My Title");
  });

  it("detects string-keyed property sinks", () => {
    const code = `
      const props = {
        "aria-label": "Close",
      };
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main", {
      contextOptions: { uiObjectFields: new Set(["aria-label"]) },
    });
    expect(ctx.rawSinks).toHaveLength(1);
    expect(ctx.rawSinks[0].text).toBe("Close");
  });

  it("ignores properties not in uiObjectFields", () => {
    const code = `const x = { notAUiField: "ignored" };`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(0);
  });

  it("handles multiple translatable properties in one object", () => {
    const code = `
      const props = {
        title: "Page Title",
        placeholder: "Enter value",
      };
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main", {
      contextOptions: { uiObjectFields: new Set(["title", "placeholder"]) },
    });
    expect(ctx.rawSinks).toHaveLength(2);
  });

  it("registers messages for property sinks", () => {
    const code = `const props = { title: "Hello" };`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.messages.size).toBe(1);
    const msg = Array.from(ctx.messages.values())[0];
    expect(msg.boundaryId).toBe("src/main");
  });
});

// ─── §6: Template Literal Variables ──────────────────────────────────────────

describe("Template literal — variable extraction", () => {
  it("extracts a simple identifier variable from a template literal sink", () => {
    const code = "el.innerHTML = `Hello ${name}`;";
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(1);
    expect(ctx.rawSinks[0].variables).toHaveLength(1);
    expect(ctx.rawSinks[0].variables[0].name).toBe("name");
  });

  it("extracts a MemberExpression variable using its property name", () => {
    const code = "el.innerHTML = `Hello ${user.name}`;";
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks[0].variables[0].name).toBe("user_name");
  });

  it("falls back to var0, var1 for complex expressions", () => {
    const code = "el.innerHTML = `Count: ${a + b}`;";
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    // Standard ZRS normalization: var0 -> input
    expect(ctx.rawSinks[0].variables[0].name).toBe("input");
  });

  it("handles multiple variables in one template literal", () => {
    const code = "el.innerHTML = `${greeting}, ${name}!`;";
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks[0].variables).toHaveLength(2);
    const names = ctx.rawSinks[0].variables.map((v: any) => v.name);
    expect(names).toContain("greeting");
    expect(names).toContain("name");
  });
});

// ─── §8: Boundary Ownership ───────────────────────────────────────────────────

describe("Boundary ownership", () => {
  it("assigns the correct boundaryId to extracted sinks", () => {
    const code = `el.innerHTML = "Hello";`;
    const ctx = runBindingVisitor(code, "src/components/Button.tsx", "src/components/Button");
    expect(ctx.rawSinks[0].boundaryId).toBe("src/components/Button");
  });

  it("assigns boundaryId to messages", () => {
    const code = `el.innerHTML = "Hello";`;
    const ctx = runBindingVisitor(code, "src/components/Button.tsx", "src/components/Button");
    const msg = Array.from(ctx.messages.values())[0];
    expect(msg.boundaryId).toBe("src/components/Button");
  });

  it("does not extract sinks when boundary is inactive", () => {
    const code = `el.innerHTML = "Should be ignored";`;
    const ctx = new ExtractionContext(code, "src/main.ts", "src/main");
    // Manually deactivate the boundary
    (ctx as any).boundaryStack = [{ id: "src/main", active: false }];
    const { program } = parseSync("src/main.ts", code);
    const visitor = createBindingVisitor(ctx) as any;
    walk(program, visitor, ctx);
    expect(ctx.rawSinks).toHaveLength(0);
  });
});

// ─── §9: Edge Cases ───────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("handles an empty file without throwing", () => {
    expect(() => runBindingVisitor("", "src/main.ts", "src/main")).not.toThrow();
  });

  it("handles a file with no imports or sinks", () => {
    const code = `const x = 1 + 2;`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.rawSinks).toHaveLength(0);
    expect(ctx.messages).toHaveLength(0);
    expect(ctx.transforms).toHaveLength(0);
    expect(ctx.dependencyPaths.size).toBe(0);
  });

  it("does not register a sink for an empty string literal", () => {
    const code = `el.innerHTML = "";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    // Empty strings are typically not translatable — adjust if your extractor includes them
    expect(ctx.rawSinks.every((s: any) => s.text !== "")).toBe(true);
  });

  it("handles mixed imports and sinks in one file", () => {
    const code = `
      import { t } from "zintl";
      import "./styles.css";
      import { helper } from "./utils";
      el.innerHTML = "Hello";
      document.title = "My App";
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.runtimeImports).toContain("t");
    expect(ctx.dependencyPaths.has("src/utils")).toBe(true);
    expect(ctx.dependencyPaths.size).toBe(1); // css filtered out
    expect(ctx.rawSinks).toHaveLength(2);
  });

  it("two separate files produce independent contexts", () => {
    const code = `el.innerHTML = "Hello";`;
    const ctx1 = runBindingVisitor(code, "src/a.ts", "src/a");
    const ctx2 = runBindingVisitor(code, "src/b.ts", "src/b");
    expect(ctx1.rawSinks[0].boundaryId).toBe("src/a");
    expect(ctx2.rawSinks[0].boundaryId).toBe("src/b");
  });

  it("does not mutate ctx between two runs", () => {
    const code = `el.innerHTML = "Hello";`;
    const ctx1 = runBindingVisitor(code, "src/main.ts", "src/main");
    const ctx2 = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx1.rawSinks).toHaveLength(1);
    expect(ctx2.rawSinks).toHaveLength(1);
  });

  it("resolveBoundaryId ignores non-relative imports with dots that are not source files", () => {
    const ctx = runBindingVisitor(`import "lib.pkg";`, "src/main.ts", "src/main");
    expect(ctx.dependencyPaths.size).toBe(0);
  });

  it("resolveExpressionName handles complex MemberExpressions", () => {
    const code = "el.innerHTML = `Val: ${ (func()).prop }`;";
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    // (func()).prop -> parts = ["prop"], curr = CallExpression.
    // returns parts[0] -> "prop"
    expect(ctx.rawSinks[0].variables[0].name).toBe("prop");
  });

  it("ImportDeclaration handles default imports", () => {
    const code = `import Default from "./module";`;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main");
    expect(ctx.dependencyPaths.has("src/module")).toBe(true);
    const bindings = ctx.dependencyBindings.get("src/module");
    expect(bindings).toBeDefined();
    expect(bindings!.has("default")).toBe(true);
  });

  it("VariableDeclaration respects @zintl-ignore", () => {
    const code = `
      // @zintl-ignore
      const x = { title: "Ignored" };
      const y = { title: "Visible" };
    `;
    const ctx = runBindingVisitor(code, "src/main.ts", "src/main", { combined: true });
    // In our simplified test setup, the comment attachment might be tricky.
    // Let's ensure it's actually suppressed.
    const texts = ctx.rawSinks.map((s) => s.text);
    // If it fails, we might need to adjust the proximity check or how we walk.
    expect(texts).toContain("Visible");
    expect(texts).not.toContain("Ignored");
  });
});
