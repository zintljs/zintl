/**
 * Which DOM properties are default sink targets, and why the line falls there.
 *
 * `dom:prop:` matches a property name and learns nothing about the receiver —
 * there is no type information on an oxc parse, and dataflow tracing was
 * removed deliberately (backlog 005). So the name has to carry the evidence on
 * its own, and only some names can.
 *
 * `innerHTML`, `textContent` and `innerText` are DOM coinages: nobody gives an
 * ordinary object a field called `innerHTML`. `title`, `alt`, `value`,
 * `placeholder` and the `aria-*` pair are ordinary English words that appear on
 * configs, payloads and telemetry — so as *defaults* they broke the rule that a
 * default target must never catch text that is not user-facing. See proposal
 * 033 §9.1.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("dom:prop default targets", () => {
  let compiler: ZintlCompiler;
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-dom-prop-");
    context.root = root;
    compiler = createTestCompiler(
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
  });

  const extract = async (body: string) => {
    await compiler.transform(
      `import { zintl } from "zintljs";\nzintl(navigator.language);\n${body}`,
      join(root, "src/main.ts"),
      "virtual:zintl/inject",
    );
    await compiler.flush();
    const keys = new Set<string>();
    for (const entries of Object.values(compiler.messages.internalManifest)) {
      for (const e of entries) keys.add(e.text);
    }
    return keys;
  };

  it("still extracts the DOM text coinages", async () => {
    const keys = await extract(`
      const el = document.querySelector("#a") as any;
      el.textContent = "TEXTCONTENT";
      el.innerHTML = "INNERHTML";
      el.innerText = "INNERTEXT";
    `);
    expect([...keys].sort()).toEqual(["INNERHTML", "INNERTEXT", "TEXTCONTENT"]);
  });

  /**
   * The regression this guards. Every one of these was extracted, written to a
   * catalog, and returned translated at runtime — so an analytics event name
   * came back in Arabic, and the build failed until someone translated it.
   */
  it("no longer extracts the English-word properties by default", async () => {
    const keys = await extract(`
      const featureFlag = {} as any;
      featureFlag.value = "NOT_UI_value";
      const img = {} as any;
      img.alt = "NOT_UI_alt";
      const field = {} as any;
      field.placeholder = "NOT_UI_placeholder";
      const node = {} as any;
      node["aria-label"] = "NOT_UI_aria";
    `);
    expect([...keys]).toEqual([]);
  });

  /**
   * The receiver is what makes `title` admissible where its neighbours were not.
   *
   * `document` is a literal identifier in the source, so `document.title` is
   * structural evidence — the same kind `jsx:<element>:<attribute>` rests on.
   * A bare `.title` is a guess about a noun, and this is the pair that proves
   * the descriptor tells them apart.
   */
  describe("receiver-qualified dom:document:title", () => {
    it("extracts the browser tab title", async () => {
      const keys = await extract(`document.title = "REAL_PAGE_TITLE";`);
      expect([...keys]).toEqual(["REAL_PAGE_TITLE"]);
    });

    it("leaves an identically-named property on anything else alone", async () => {
      const keys = await extract(`
        const telemetry = {} as any;
        telemetry.title = "NOT_UI_title";
        const chart = {} as any;
        chart.title = "NOT_UI_chart_title";
      `);
      expect([...keys]).toEqual([]);
    });

    /**
     * A deliberate floor. Matching a member chain means walking arbitrary
     * receivers, which re-admits the guessing the descriptor exists to remove.
     */
    it("does not follow a member-expression receiver", async () => {
      const keys = await extract(`window.document.title = "VIA_WINDOW";`);
      expect([...keys]).toEqual([]);
    });
  });

  /**
   * Dropped from the *defaults*, not from the DSL. A project that wants them
   * says so, and owns the false positives — which is the whole bargain.
   */
  it("still supports them when a project asks for them", async () => {
    const { createTestCompilerWith } = await import("../helpers/compiler.js");
    const { vanillaFacet } = await import("@zintljs/compiler/facets");
    const c = createTestCompilerWith(
      [vanillaFacet({ targets: ["dom:prop:textContent", "dom:prop:title"] })],
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
    await c.setup();
    await c.transform(
      `import { zintl } from "zintljs";\nzintl(navigator.language);\nconst el = {} as any;\nel.title = "OPTED_IN";`,
      join(root, "src/opt.ts"),
      "virtual:zintl/inject",
    );
    await c.flush();
    const keys = new Set<string>();
    for (const entries of Object.values(c.messages.internalManifest))
      for (const e of entries) keys.add(e.text);
    expect(keys.has("OPTED_IN")).toBe(true);
  });
});
