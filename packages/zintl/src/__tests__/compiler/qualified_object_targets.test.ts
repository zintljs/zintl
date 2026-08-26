/**
 * `obj:<binding>:<field>` and `call:<function>:<field>`.
 *
 * `obj:*:title` matches a field name on any object anywhere — a guess about a
 * noun, and the reason an analytics constant could end up translated. These two
 * narrow the same match by *context*: the binding the object belongs to, or the
 * call it was passed to. Still a name, but one the project chose and controls,
 * which is the whole of the bargain (proposal 033 §4).
 *
 * Reference: docs/spec/ZRS.md §15.3
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
 * A compiler whose *only* extraction targets are the ones named here.
 *
 * Built from a bare facet list rather than the shared harness, and that is the
 * point of the comment. The baseline world includes the React facet, and
 * `jsxExtractionFacet` declares the same `obj:field:title` family `vanillaFacet`
 * does — so overriding vanilla alone left the defaults matching everything, and
 * every negative assertion here passed for the wrong reason. Array capabilities
 * merge by union: narrowing one contributor narrows nothing.
 */
async function withTargets(targets: string[]) {
  const c = new ZintlCompiler(
    {
      locales: ["en", "ar"],
      sourceLocale: "en",
      outputDir: "zintl",
      logLevel: "silent",
      verifyIntegrity: false,
      capabilities: resolveFacets(
        [vanillaFacet({ targets: targets as never[] }), viteFacet()].flat(Infinity) as never[],
      ),
    } as never,
    root,
    true,
  );
  await c.setup();
  return c;
}

async function keysFor(c: ZintlCompiler, body: string, file = "src/main.ts") {
  await c.transform(
    `import { zintl } from "zintljs";\nzintl(navigator.language);\n${body}`,
    join(root, file),
    "virtual:zintl/inject",
  );
  await c.flush();
  const keys = new Set<string>();
  for (const entries of Object.values(c.messages.internalManifest)) {
    for (const e of entries) keys.add(e.text);
  }
  return keys;
}

describe("qualified object targets", () => {
  beforeEach(async (context: TestContext) => {
    root = await createTestDir("zintl-qualified-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
  });

  describe("obj:<binding>:<field>", () => {
    /**
     * Every shape a strings object is actually written in. The plain object is
     * the easy one; the two function forms are the reason the walk crosses
     * function bodies rather than stopping at the nearest scope.
     */
    it("resolves the binding through each way an object can be produced", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(
        c,
        `
        const ui = { title: "PLAIN" };
        const arrowBlock = () => { return { title: "ARROW_BLOCK" }; };
        const arrowConcise = () => ({ title: "ARROW_CONCISE" });
        function declared() { return { title: "FN_DECL" }; }
        void [ui, arrowBlock, arrowConcise, declared];
      `,
      );
      // Only `ui` is a declared target; the other three bindings are not.
      expect([...keys]).toEqual(["PLAIN"]);
    });

    it("matches each named binding it was given", async () => {
      const c = await withTargets(["obj:ui:title", "obj:arrowConcise:title", "obj:declared:title"]);
      const keys = await keysFor(
        c,
        `
        const ui = { title: "PLAIN" };
        const arrowConcise = () => ({ title: "ARROW_CONCISE" });
        function declared() { return { title: "FN_DECL" }; }
        void [ui, arrowConcise, declared];
      `,
      );
      expect([...keys].sort()).toEqual(["ARROW_CONCISE", "FN_DECL", "PLAIN"]);
    });

    /**
     * Nesting matters more than it looks: `{ home: { title }, about: { title } }`
     * is what a real strings object is shaped like, so a direct-child-only rule
     * would make the feature useless for its main use.
     */
    it("reaches a field nested inside the binding", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(c, `const ui = { home: { title: "NESTED" } }; void ui;`);
      expect([...keys]).toEqual(["NESTED"]);
    });

    it("leaves the same field on a different binding alone", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(
        c,
        `
        const telemetry = { title: "NOT_UI" };
        const chart = { title: "ALSO_NOT_UI" };
        void [telemetry, chart];
      `,
      );
      expect([...keys]).toEqual([]);
    });

    it("takes the innermost binding, not an enclosing one", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(
        c,
        `const ui = { nested: (() => { const inner = { title: "INNER" }; return inner; })() }; void ui;`,
      );
      // `inner` is the nearest binding and is not a target, so `ui` must not
      // capture it from further out.
      expect([...keys]).toEqual([]);
    });

    it("matches a class field binding", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(c, `class K { ui = { title: "CLASS_FIELD" }; } void K;`);
      expect([...keys]).toEqual(["CLASS_FIELD"]);
    });

    /**
     * A stated limit. There is no name to declare a target against, so marking
     * the site is what a directive is for (033 §5).
     */
    it("cannot reach an anonymous default export", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(c, `export default { title: "DEFAULT_EXPORT" };`);
      expect([...keys]).toEqual([]);
    });
  });

  /**
   * The name is the **local** binding, never an export alias.
   *
   * Three reasons, and the third is the one that settles it (proposal 033 §9.3).
   * It is what the walk can see — an alias lives in a separate export
   * declaration elsewhere in the module. There is not always *one* exported
   * name: `export { ui as strings, ui as messages }` is legal, and a re-export
   * chain adds more, while the local binding is always singular. And a target
   * is a statement about the shape of the source, not about a module's public
   * surface — you can answer "does this match?" by reading the declaration,
   * without scanning the module's exports.
   */
  describe("which name counts", () => {
    it("matches when the binding is exported under its own name", async () => {
      const c = await withTargets(["obj:ui:title"]);
      expect([...(await keysFor(c, `export const ui = { title: "PLAIN_EXPORT" };`))]).toEqual([
        "PLAIN_EXPORT",
      ]);
    });

    it("matches the local name even when the export renames it", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(
        c,
        `const ui = { title: "LOCAL_WINS" };\nexport { ui as strings };`,
      );
      expect([...keys]).toEqual(["LOCAL_WINS"]);
    });

    it("does not match an export alias that happens to be the target", async () => {
      const c = await withTargets(["obj:ui:title"]);
      const keys = await keysFor(
        c,
        `const strings = { title: "ALIAS_IGNORED" };\nexport { strings as ui };`,
      );
      expect([...keys]).toEqual([]);
    });
  });

  describe("call:<function>:<field>", () => {
    it("matches an object literal passed to the named call", async () => {
      const c = await withTargets(["call:defineConfig:title"]);
      const keys = await keysFor(c, `defineConfig({ title: "FROM_CALL" });`);
      expect([...keys]).toEqual(["FROM_CALL"]);
    });

    /**
     * The reason this is its own family rather than a spelling of `obj:`.
     * "Passed to `cfg()`" and "bound to `cfg`" are different relations, and one
     * descriptor covering both would match a `const cfg = { … }` that has
     * nothing to do with the call.
     */
    it("does not match a binding that merely shares the name", async () => {
      const c = await withTargets(["call:defineConfig:title"]);
      const keys = await keysFor(
        c,
        `const defineConfig = { title: "NOT_A_CALL" }; void defineConfig;`,
      );
      expect([...keys]).toEqual([]);
    });

    it("still resolves when the call's result is bound", async () => {
      const c = await withTargets(["call:defineConfig:title"]);
      const keys = await keysFor(c, `const cfg = defineConfig({ title: "BOUND_CALL" }); void cfg;`);
      expect([...keys]).toEqual(["BOUND_CALL"]);
    });

    it("leaves an unnamed call alone", async () => {
      const c = await withTargets(["call:defineConfig:title"]);
      const keys = await keysFor(c, `somethingElse({ title: "OTHER_CALL" });`);
      expect([...keys]).toEqual([]);
    });
  });

  /** `obj:*:` says plainly what the unqualified form does. */
  it("treats obj:*: and obj:field: as the same any-object match", async () => {
    for (const form of ["obj:*:title", "obj:field:title"]) {
      root = await createTestDir("zintl-qualified-alias-");
      await mkdir(join(root, "src"), { recursive: true });
      const c = await withTargets([form]);
      const keys = await keysFor(c, `const anything = { title: "ANY_OBJECT" }; void anything;`);
      expect([...keys]).toEqual(["ANY_OBJECT"]);
    }
  });
});
