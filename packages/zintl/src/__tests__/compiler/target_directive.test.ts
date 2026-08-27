/**
 * `@zintl-target` — opt a site in, at the site.
 *
 * The mirror of `@zintl-ignore`, and the other half of proposal 033 §5. The
 * declared targets of §4 resolve a *name*; some sites have none — an anonymous
 * default export above all — and a name is also the thing that breaks when
 * somebody renames a binding. This marks the code instead, so it survives a
 * rename and is visible to whoever reads the file.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { vanillaFacet, viteFacet } from "@zintljs/compiler/facets";
import { ZintlCompiler } from "@zintljs/compiler";
import { resolveFacets } from "../../facets/resolve.js";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

let root: string;

/**
 * A compiler with **no** object-field targets at all, so anything extracted
 * here was extracted by the directive and nothing else.
 */
async function compiler() {
  const c = new ZintlCompiler(
    {
      locales: ["en", "ar"],
      sourceLocale: "en",
      outputDir: "zintl",
      logLevel: "silent",
      verifyIntegrity: false,
      capabilities: resolveFacets(
        [vanillaFacet({ targets: ["dom:prop:textContent"] as never[] }), viteFacet()].flat(
          Infinity,
        ) as never[],
      ),
    } as never,
    root,
    true,
  );
  await c.setup();
  return c;
}

async function keys(body: string) {
  const c = await compiler();
  await c.transform(
    `import { zintl } from "zintljs";\nzintl(navigator.language);\n${body}`,
    join(root, "src/main.ts"),
    "virtual:zintl/inject",
  );
  await c.flush();
  const out = new Set<string>();
  for (const entries of Object.values(c.messages.internalManifest)) {
    for (const e of entries) out.add(e.text);
  }
  return out;
}

describe("@zintl-target", () => {
  beforeEach(async (context: TestContext) => {
    root = await createTestDir("zintl-target-directive-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
  });

  it("extracts nothing from an unmarked object", async () => {
    expect([...(await keys(`const ui = { title: "UNMARKED" }; void ui;`))]).toEqual([]);
  });

  /**
   * The case §4's declared targets structurally cannot reach: there is no
   * binding to name.
   */
  it("reaches an anonymous default export", async () => {
    const found = await keys(`
      // @zintl-target
      export default { title: "DEFAULT_TITLE", description: "DEFAULT_DESC" };
    `);
    expect([...found].sort()).toEqual(["DEFAULT_DESC", "DEFAULT_TITLE"]);
  });

  it("reaches an object passed inline to a call", async () => {
    const found = await keys(`
      // @zintl-target
      defineConfig({ title: "CALL_TITLE" });
    `);
    expect([...found]).toEqual(["CALL_TITLE"]);
  });

  /**
   * Every field, whatever it is called. Requiring the names to *also* be
   * configured would leave the directive useful only where the configuration
   * already sufficed.
   */
  it("takes every field in the marked object, regardless of name", async () => {
    const found = await keys(`
      // @zintl-target
      const strings = { heading: "H", blurb: "B", cta: "C" };
      void strings;
    `);
    expect([...found].sort()).toEqual(["B", "C", "H"]);
  });

  it("reaches nested objects inside the marked region", async () => {
    const found = await keys(`
      // @zintl-target
      const ui = { home: { heading: "NESTED_H" } };
      void ui;
    `);
    expect([...found]).toEqual(["NESTED_H"]);
  });

  /** The pair composes: mark the object, exclude the field that is a URL. */
  it("still honours @zintl-ignore inside a marked region", async () => {
    const found = await keys(`
      // @zintl-target
      const ui = { heading: "KEPT" };
      // @zintl-ignore
      const other = { heading: "DROPPED" };
      void [ui, other];
    `);
    expect([...found]).toEqual(["KEPT"]);
  });

  /**
   * A region ends where its statement does. Nesting is why the level is a
   * counter and not a boolean, and this is what would break if it were one.
   */
  it("does not leak past the statement it marks", async () => {
    const found = await keys(`
      // @zintl-target
      const marked = { heading: "INSIDE" };
      const after = { heading: "OUTSIDE" };
      void [marked, after];
    `);
    expect([...found]).toEqual(["INSIDE"]);
  });

  /**
   * ZRS §15.5: *"Regions nest, so the depth MUST be counted rather than
   * flagged — an inner region ending must not end the outer."*
   *
   * This is the assertion that separates a counter from a boolean, and it needs
   * a field positioned **after** the inner region but still inside the outer
   * one. With a flag, the inner region's exit clears it and `AFTER_INNER` is
   * lost; nothing else in the suite would notice.
   */
  it("keeps the outer region alive when a nested one ends", async () => {
    const found = await keys(`
      // @zintl-target
      const outer = {
        a: (() => {
          // @zintl-target
          return { b: "INNER" };
        })(),
        c: "AFTER_INNER",
      };
      void outer;
    `);
    expect([...found].sort()).toEqual(["AFTER_INNER", "INNER"]);
  });

  it("survives renaming the binding, which a declared target would not", async () => {
    const found = await keys(`
      // @zintl-target
      const renamedYesterday = { heading: "STILL_FOUND" };
      void renamedYesterday;
    `);
    expect([...found]).toEqual(["STILL_FOUND"]);
  });

  it("reaches an object returned from a function", async () => {
    const found = await keys(`
      function build() {
        // @zintl-target
        return { heading: "FROM_RETURN" };
      }
      void build;
    `);
    expect([...found]).toEqual(["FROM_RETURN"]);
  });

  it("reaches a class field", async () => {
    const found = await keys(`
      class K {
        // @zintl-target
        ui = { heading: "CLASS_FIELD" };
      }
      void K;
    `);
    expect([...found]).toEqual(["CLASS_FIELD"]);
  });
});
