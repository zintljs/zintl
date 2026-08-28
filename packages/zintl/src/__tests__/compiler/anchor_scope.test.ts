/**
 * A boundary's id must be spelled the same everywhere, whatever holds the anchor.
 *
 * ## What this is guarding
 *
 * Normalizing a boundary id — which extensions to strip — is implemented three
 * times: `IOManager.getNormalizedId` keys the graph, `calculateSafeBoundaryId`
 * mints the ids that reach emitted code, and `stripExtensions` normalizes inside
 * codegen. They must answer identically, and one of them did not: it also
 * stripped `.tsx`/`.jsx`.
 *
 * That is invisible for a **function-scoped** anchor, because the strip regex is
 * anchored at end-of-string and `src/main.tsx:boot` has no trailing extension.
 * A **module-scoped** anchor — `src/main.tsx`, the shape CLAUDE.md gives as the
 * definition of an entry point — became `src/main`, which names no node in the
 * graph. The manager was then generated for an id belonging to no chunk: it
 * loaded with a 200 and registered no catalog, so every string in any *other*
 * boundary rendered pseudo-localized.
 *
 * ## Why it is written as a matrix
 *
 * The defect was a disagreement between keep-lists, so the axis that matters is
 * **which extension** crossed with **where the anchor sits** — not which
 * framework. `.vue` was immune because every implementation keeps SFC
 * extensions; `.ts` was immune because every implementation strips it. Only the
 * cell where the lists disagreed was broken, and a test that checked one cell
 * would have passed throughout.
 *
 * The assertion is the same in every cell and is deliberately not "the id equals
 * this string": the manager's id must name **the chunk this boundary actually
 * lands in**. That is the invariant; the spelling is an implementation detail
 * that may legitimately change.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler, createTestCompilerWith } from "../helpers/compiler.js";
import { vueFacet } from "@zintljs/compiler/facets";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/** The manager import the entry ends up carrying, split into kind and id. */
function managerRef(code: string): { kind: string; id: string } | null {
  const m = code.match(/manager\/[^/]+\/([a-z]+):([A-Za-z0-9_%]+)/);
  return m ? { kind: m[1], id: decodeURIComponent(m[2]) } : null;
}

/**
 * Every chunk the graph knows, as `id → member boundary ids`.
 *
 * Read off the compiler rather than recomputed, because the whole question is
 * whether codegen and the graph agree — deriving the expectation a second way
 * would let both be wrong together.
 */
function chunksOf(compiler: ZintlCompiler) {
  const cg = (compiler as unknown as { graph: { chunkGraph: any } }).graph.chunkGraph;
  return Array.from(cg.chunks.values()) as { id: string; type: string; boundaries: Set<string> }[];
}

describe("anchor scope and boundary-id spelling", () => {
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-anchor-scope-");
    context.root = root;
  });

  /**
   * Build a two-file project: an entry holding the anchor, and a separate
   * module holding the string.
   *
   * The second file is what makes the defect observable at all. With everything
   * in one boundary the wrong id is used consistently on both sides and the page
   * renders correctly — which is why a single-file fixture passed throughout.
   */
  async function compile(opts: {
    ext: string;
    scope: "module" | "function";
    dep: string;
    entry: (depImport: string, anchor: string) => string;
    extraFacets?: unknown[];
  }) {
    const compiler = opts.extraFacets
      ? createTestCompilerWith(
          opts.extraFacets,
          {
            locales: ["en", "ar"],
            sourceLocale: "en",
            outputDir: "zintl",
            logLevel: "silent",
            verifyIntegrity: false,
          },
          root,
          true,
        )
      : createTestCompiler(
          {
            locales: ["en", "ar"],
            sourceLocale: "en",
            outputDir: "zintl",
            logLevel: "silent",
            verifyIntegrity: false,
          },
          root,
          true,
        );

    await compiler.setup();
    await mkdir(join(root, "src"), { recursive: true });

    const depFile = `src/greeting${opts.ext}`;
    await compiler.transform(opts.dep, join(root, depFile), "virtual:zintl/inject");

    const anchor =
      opts.scope === "module"
        ? `await zintl(navigator.language);\nrender();`
        : `async function boot() { await zintl(navigator.language); render(); }\nvoid boot();`;
    const entryFile = `src/main${opts.ext === ".vue" ? ".ts" : opts.ext}`;
    const res = await compiler.transform(
      opts.entry(`./greeting${opts.ext}`, anchor),
      join(root, entryFile),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    return { compiler, code: res!.code };
  }

  /**
   * The invariant, stated once: whatever id the manager names, a chunk of that
   * kind must exist for it.
   */
  function expectManagerNamesItsChunk(compiler: ZintlCompiler, code: string) {
    const ref = managerRef(code);
    expect(ref, "the entry should carry a manager import").not.toBeNull();

    const chunks = chunksOf(compiler);
    const named = chunks.find((c) => c.id === `${ref!.kind}_${ref!.id}`);

    expect(
      named,
      `manager names "${ref!.kind}:${ref!.id}" but the graph has ${chunks
        .map((c) => c.id)
        .join(", ")}`,
    ).toBeDefined();
  }

  const JSX_DEP = `export function Greeting() {
  return <h1>Welcome back!</h1>;
}`;
  const JSX_ENTRY = (dep: string, anchor: string) =>
    [
      `import { zintl } from "zintljs/macro";`,
      `import { Greeting } from "${dep}";`,
      `function render() { document.body.appendChild(<Greeting />); }`,
      anchor,
    ].join("\n");

  /**
   * The string sits on a DOM sink rather than in a returned value: a bare
   * `return "..."` is not a sink, so a dep written that way extracts nothing,
   * emits no manager, and the cell would pass for the wrong reason.
   */
  const TS_DEP = `export function greeting(el: HTMLElement) { el.textContent = "Welcome back!"; }`;
  const TS_ENTRY = (dep: string, anchor: string) =>
    [
      `import { zintl } from "zintljs/macro";`,
      `import { greeting } from "${dep}";`,
      `function render() { greeting(document.body); }`,
      anchor,
    ].join("\n");

  /**
   * The cell the keep-lists disagreed on, and the only one that was broken.
   */
  describe("a .tsx module holding the string", () => {
    it("names its chunk from a module-scope anchor", async () => {
      const { compiler, code } = await compile({
        ext: ".tsx",
        scope: "module",
        dep: JSX_DEP,
        entry: JSX_ENTRY,
      });
      expectManagerNamesItsChunk(compiler, code);
    });

    it("names its chunk from a function-scope anchor", async () => {
      const { compiler, code } = await compile({
        ext: ".tsx",
        scope: "function",
        dep: JSX_DEP,
        entry: JSX_ENTRY,
      });
      expectManagerNamesItsChunk(compiler, code);
    });
  });

  /**
   * Immune, and worth pinning as such: every implementation strips `.ts`, so
   * the two spellings met even while they disagreed. This row was a prediction
   * read off the keep-lists before it was measured — if it ever fails, the
   * diagnosis in `stripExtensions`'s docblock is incomplete.
   */
  describe("a .ts module holding the string", () => {
    it("names its chunk from a module-scope anchor", async () => {
      const { compiler, code } = await compile({
        ext: ".ts",
        scope: "module",
        dep: TS_DEP,
        entry: TS_ENTRY,
      });
      expectManagerNamesItsChunk(compiler, code);
    });

    it("names its chunk from a function-scope anchor", async () => {
      const { compiler, code } = await compile({
        ext: ".ts",
        scope: "function",
        dep: TS_DEP,
        entry: TS_ENTRY,
      });
      expectManagerNamesItsChunk(compiler, code);
    });
  });

  /**
   * The other immune direction: SFC extensions are on every keep-list, because
   * `.vue` names a document rather than a compilation target. This is why
   * `examples/rsbuild-vue-mpa`'s module-scope `await zintl(props.lang)` worked
   * while the same shape in a `.tsx` did not.
   */
  describe("a .vue module holding the string", () => {
    const VUE_DEP = `<template><h1>Welcome back!</h1></template>`;

    it("names its chunk from a module-scope anchor", async () => {
      const { compiler, code } = await compile({
        ext: ".vue",
        scope: "module",
        dep: VUE_DEP,
        entry: (dep, anchor) =>
          [
            `import { zintl } from "zintljs/macro";`,
            `import Greeting from "${dep}";`,
            `function render() { console.log(Greeting); }`,
            anchor,
          ].join("\n"),
        extraFacets: [vueFacet()],
      });
      expectManagerNamesItsChunk(compiler, code);
    });
  });
});
