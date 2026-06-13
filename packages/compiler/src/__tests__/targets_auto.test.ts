import { describe, it, expect } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";

describe("Compiler Target Options", () => {
  it("should fall back to default presets when targets is empty or auto", () => {
    const compiler = new ZintlCompiler({}, "/non-existent-root");
    expect(compiler._options.targets).toEqual(["vanilla", "react", "html"]);

    const compilerAuto = new ZintlCompiler({ targets: ["auto"] }, "/non-existent-root");
    expect(compilerAuto._options.targets).toEqual(["vanilla", "react", "html"]);
  });

  it("should respect explicit targets override", () => {
    const compiler = new ZintlCompiler({
      targets: ["react"],
    });

    expect(compiler._options.targets).toEqual(["react"]);
  });
});
