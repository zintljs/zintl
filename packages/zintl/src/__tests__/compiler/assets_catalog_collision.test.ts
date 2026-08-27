import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompilerWith } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { assetsFacet } from "@zintljs/compiler/facets";
import type { AssetTargetConfig } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "../helpers/fs.js";

/**
 * Catalogs and localized assets share one naming scheme, and `.json` is where
 * that stops being cosmetic: `<outputDir>/<path>.<locale>.json` is what a
 * boundary's catalog is called *and* what a targeted `data.json` artifact is
 * called, so a source file whose stem matches a boundary's puts both on one
 * path. The catalog is written second and wins — leaving an artifact that is
 * really a catalog, an integrity gate that sees a non-empty file and passes,
 * and an asset that ships in the source language with nothing said.
 *
 * That is a source-locale fallback nothing downstream can detect, so the build
 * is refused rather than resolved in someone's favour. Proposal 034 §6.
 *
 * What is asserted here is that the guard tracks the paths rather than the
 * extension: the same `.json` target is fine the moment the two stop landing on
 * one file, whether because the stems differ or because `catalogFormat` put the
 * catalogs somewhere else entirely.
 */
describe("Zintl Compiler - localized assets never overwrite a catalog", () => {
  beforeEach(async (context: TestContext) => {
    context.root = await createTestDir("zintl-asset-collision-");
  });

  const compilerFor = (
    root: string,
    targets: (string | AssetTargetConfig)[],
    options: Record<string, unknown> = {},
  ): ZintlCompiler =>
    createTestCompilerWith(
      [assetsFacet({ targets })],
      {
        locales: ["en", "ar"],
        sourceLocale: "en",
        outputDir: "zintl",
        logLevel: "silent",
        ...options,
      },
      root,
      true,
    );

  /**
   * A boundary in `<stem>.ts` that imports a targeted asset next to it.
   *
   * The import is load-bearing: an asset nothing depends on is not an active
   * output, so a project that merely *has* the file has nothing to collide.
   */
  async function writeProject(root: string, stem: string, assetExt: string) {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, `src/data.${assetExt}`),
      assetExt === "json" ? '{"hello":"world"}' : "Hello world.",
    );
    await writeFile(
      join(root, `src/${stem}.ts`),
      `import { zintl, t } from "zintljs";
       import data from "./data.${assetExt}";
       zintl(navigator.language);
       console.log(t("Welcome"), data);`,
    );
  }

  it("refuses a build where an artifact and a catalog claim the same file", async (context: TestContext) => {
    const root = context.root as string;
    const compiler = compilerFor(root, ["json"]);
    await compiler.setup();
    // `src/data.json` and the boundary in `src/data.ts` both want
    // `zintl/src/data.ar.json`.
    await writeProject(root, "data", "json");
    await compiler.discover();

    const error = await compiler.flush().then(
      () => new Error("flush resolved; expected a refusal"),
      (e: unknown) => e as Error,
    );

    // The message has to be actionable on its own: which file, who claimed it,
    // whose catalog it is, and what to do about it.
    expect(error.message).toMatch(/lands on a path Zintl already writes a catalog to/);
    expect(error.message).toContain("zintl/src/data.ar.json");
    expect(error.message).toContain('claimed by "system-static-assets"');
    expect(error.message).toMatch(/and by the catalog for "/);
    expect(error.message).toContain("assetsTarget");
  });

  it("allows the same target when the two land on different paths", async (context: TestContext) => {
    const root = context.root as string;
    const compiler = compilerFor(root, ["json"]);
    await compiler.setup();
    // The boundary is `src/main.ts`, so its catalog is `zintl/src/main.ar.json`
    // and the artifact keeps `zintl/src/data.ar.json` to itself.
    await writeProject(root, "main", "json");
    await compiler.discover();

    await expect(compiler.flush()).resolves.toBeUndefined();
    expect(existsSync(join(root, "zintl/src/data.ar.json"))).toBe(true);
    expect(existsSync(join(root, "zintl/src/main.ar.json"))).toBe(true);
  });

  it("allows a colliding stem when catalogFormat moves catalogs elsewhere", async (context: TestContext) => {
    const root = context.root as string;
    // One multilingual catalog at `zintl/translations.json` — nothing is named
    // after the boundary's path, so nothing can collide with an artifact.
    const compiler = compilerFor(root, ["json"], { catalogFormat: "translations.json" });
    await compiler.setup();
    await writeProject(root, "data", "json");
    await compiler.discover();

    await expect(compiler.flush()).resolves.toBeUndefined();
    expect(existsSync(join(root, "zintl/src/data.ar.json"))).toBe(true);
  });

  it("accepts the outputPattern the refusal recommends", async (context: TestContext) => {
    const root = context.root as string;
    // The exact escape the error message names. A guard that recommends a fix
    // it has never been run against is a guess.
    const compiler = compilerFor(root, [
      { targetPattern: "**/*.json", outputPattern: "assets/[locale]/[dir]/[name].[ext]" },
    ]);
    await compiler.setup();
    await writeProject(root, "data", "json");
    await compiler.discover();

    await expect(compiler.flush()).resolves.toBeUndefined();
    expect(existsSync(join(root, "assets/ar/src/data.json"))).toBe(true);
    // The catalog kept the path the artifact vacated.
    expect(existsSync(join(root, "zintl/src/data.ar.json"))).toBe(true);
  });

  it("leaves a target whose extension is not the catalog's alone", async (context: TestContext) => {
    const root = context.root as string;
    const compiler = compilerFor(root, ["md"]);
    await compiler.setup();
    await writeProject(root, "data", "md");
    await compiler.discover();

    await expect(compiler.flush()).resolves.toBeUndefined();
    expect(existsSync(join(root, "zintl/src/data.ar.md"))).toBe(true);
  });
});
