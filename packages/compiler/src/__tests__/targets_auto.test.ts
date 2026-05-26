import { describe, it, expect } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";

describe("Compiler Target Auto-detection", () => {
  it("should fall back to default presets when nothing is detected", () => {
    const compiler = new ZintlCompiler({}, "/non-existent-root");
    expect(compiler._options.targets).toEqual(["vanilla", "react", "html"]);
  });

  it("should detect vue from package.json dependencies", () => {
    const mockRoot = join(process.cwd(), "packages/compiler/src/__tests__");
    const pkgPath = join(mockRoot, "package.json");

    // Write a mock package.json
    writeFileSync(
      pkgPath,
      JSON.stringify({
        dependencies: {
          vue: "^3.0.0",
        },
      }),
    );

    try {
      const compiler = new ZintlCompiler({}, mockRoot);
      expect(compiler._options.targets).toContain("vue");
      expect(compiler._options.targets).toContain("vanilla");
      expect(compiler._options.targets).toContain("html");
      expect(compiler._options.targets).not.toContain("react");
      expect(compiler._options.targets).not.toContain("svelte");
    } finally {
      try {
        unlinkSync(pkgPath);
      } catch {}
    }
  });

  it("should detect frameworks from vitePlugins option", () => {
    const compiler = new ZintlCompiler({
      vitePlugins: [{ name: "vite:react-jsx" }, { name: "vite-plugin-svelte" }],
    });

    expect(compiler._options.targets).toContain("react");
    expect(compiler._options.targets).toContain("svelte");
    expect(compiler._options.targets).toContain("vanilla");
    expect(compiler._options.targets).toContain("html");
    expect(compiler._options.targets).not.toContain("vue");
  });

  it("should respect explicit targets override over auto", () => {
    const compiler = new ZintlCompiler({
      targets: ["react"],
      vitePlugins: [{ name: "vite:vue" }],
    });

    expect(compiler._options.targets).toEqual(["react"]);
  });
});
