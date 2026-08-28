/**
 * Handing strings to a translation system (proposal 032 §7 step 3).
 *
 * The claim is not "Zintl writes XLIFF" — plenty of things write XLIFF. It is
 * that the file carries what the boundary graph knows and a TMS cannot compute:
 * which screens a string reaches, how many places share it, what expression is
 * behind `{input}`, and whether a translation was carried forward onto edited
 * source. §3 calls that the actual pitch, and a note nobody can read is a fact
 * that did not travel — so these tests assert the **notes a translator sees**,
 * not an internal structure.
 *
 * The seam is asserted too: nothing in the compiler knows what XLIFF is, so
 * every assertion here goes through a facet the project opted into.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompilerWith } from "../helpers/compiler.js";
import { xliffFacet } from "@zintljs/compiler/facets";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("XLIFF export", () => {
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-xliff-");
    context.root = root;
  });

  function make(options: Record<string, unknown> = {}, isDev = false) {
    return createTestCompilerWith(
      [xliffFacet()],
      {
        locales: ["en", "ar"],
        sourceLocale: "en",
        outputDir: "zintl",
        logLevel: "silent",
        verifyIntegrity: false,
        ...options,
      },
      root,
      isDev,
    );
  }

  /** One entry, one shared component, one interpolation, one authored note. */
  async function seed(compiler: ZintlCompiler) {
    await mkdir(join(root, "src"), { recursive: true });
    await compiler.transform(
      `
        import { t } from "zintljs";
        export const Footer = () => <footer><button>Save changes</button></footer>;
      `,
      join(root, "src/Footer.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.transform(
      `
        import { zintl } from "zintljs";
        import { Footer } from "./Footer.tsx";
        zintl(navigator.language);
        export const Checkout = ({ user }) => (
          <div>
            {/* @zintl-note Shown after a successful payment */}
            <h1>Welcome back, {user.firstName}!</h1>
            <button>Save changes</button>
            <Footer />
          </div>
        );
      `,
      join(root, "src/Checkout.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.flush();
  }

  const read = () => readFile(join(root, "l10n/ar.xlf"), "utf-8");

  it("writes one file per non-source locale, as valid XLIFF 2.0", async () => {
    const compiler = make({ locales: ["en", "ar", "fr"] });
    await compiler.setup();
    await seed(compiler);

    expect(await exists(join(root, "l10n/ar.xlf"))).toBe(true);
    expect(await exists(join(root, "l10n/fr.xlf"))).toBe(true);
    // The source locale is diskless and translated by definition.
    expect(await exists(join(root, "l10n/en.xlf"))).toBe(false);

    const xml = await read();
    expect(xml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
    expect(xml).toContain(`xmlns="urn:oasis:names:tc:xliff:document:2.0"`);
    expect(xml).toContain(`version="2.0"`);
    expect(xml).toContain(`srcLang="en"`);
    expect(xml).toContain(`trgLang="ar"`);
  });

  /**
   * Nothing is written while serving. An export is a batch act — 032 §9 rules
   * out live sync explicitly — and rewriting XML on every keystroke would make
   * it one.
   */
  it("writes nothing while serving", async () => {
    const compiler = make({}, true);
    await compiler.setup();
    await seed(compiler);

    expect(await exists(join(root, "l10n/ar.xlf"))).toBe(false);
  });

  it("says whether each string is translated, using the same answer the gate uses", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);

    expect(await read()).toContain(`<segment state="initial">`);

    compiler.messages.hive["ar"] = { "Save changes": "حفظ التغييرات" };
    await compiler.flush();

    const xml = await read();
    expect(xml).toContain(`<target>حفظ التغييرات</target>`);
    expect(xml).toContain(`<segment state="translated">`);
  });

  /**
   * The §3 payload, which is the whole reason this is not a JSON dump.
   */
  describe("what a translator is told", () => {
    it("names the element the string sat in", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);
      expect(await read()).toContain(`<note category="zintl:element">Appears as: button</note>`);
    });

    it("names the screens it reaches", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);
      expect(await read()).toContain(`<note category="zintl:screens">Appears on: src/Checkout.tsx`);
    });

    /**
     * The fact no TMS can compute, because no TMS knows what a boundary is.
     */
    it("warns that a shared string is shared, and exports it exactly once", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);

      const xml = await read();
      expect(xml).toContain(`category="zintl:shared"`);
      expect(xml).toContain(`one translation covers all of them`);

      /**
       * The half that matters more than the note. Grouping by boundary put
       * "Save changes" in the file twice — asking a translator for the same
       * words in two places, with nothing saying the answers must match, and a
       * hive keyed by source text that would keep whichever arrived last.
       */
      expect(xml.match(/<source>Save changes<\/source>/g)).toHaveLength(1);
    });

    it("says what is behind a placeholder", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);
      expect(await read()).toContain(
        `<note category="zintl:placeholder">{user_firstName} is user.firstName</note>`,
      );
    });

    it("carries the authored @zintl-note through", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);
      expect(await read()).toContain(
        `<note category="zintl:note">Shown after a successful payment</note>`,
      );
    });
  });

  /**
   * §1: Zintl reconciles first and the export **states the answer**, so the
   * TMS's own fuzzy matcher never gets a turn. Two translation memories
   * guessing independently is a wrong-rename generator, and the failure is
   * miserable to debug because neither side is malfunctioning.
   */
  describe("a carry-forward", () => {
    async function editTheString(compiler: ZintlCompiler) {
      await compiler.transform(
        `
          import { zintl } from "zintljs";
          zintl(navigator.language);
          export const App = () => <button>Save the changes</button>;
        `,
        join(root, "src/Checkout.tsx"),
        "virtual:zintl/inject",
      );
      await compiler.flush();
    }

    it("ships pre-filled, flagged, and with the old wording named", async () => {
      const compiler = make();
      await compiler.setup();
      await mkdir(join(root, "src"), { recursive: true });
      await compiler.transform(
        `
          import { zintl } from "zintljs";
          zintl(navigator.language);
          export const App = () => <button>Save changes</button>;
        `,
        join(root, "src/Checkout.tsx"),
        "virtual:zintl/inject",
      );
      await compiler.flush();

      compiler.messages.hive["ar"] = { "Save changes": "حفظ التغييرات" };
      await compiler.flush();
      await editTheString(compiler);

      const xml = await read();
      expect(xml).toContain(`subState="zintl:carried-forward"`);
      expect(xml).toContain(`category="zintl:carried-forward"`);
      // The old wording, so a translator can judge the match rather than trust it.
      expect(xml).toContain(`Save changes`);
      expect(xml).toContain(`% similar`);
    });
  });

  /**
   * 031 × 032, and §9 said the two designs would meet here.
   *
   * A pending locale is *exactly* the state a TMS is working through — a locale
   * being stood up over weeks is the reason to hand strings to translators at
   * all — so excluding it would omit the one locale most likely to need this.
   */
  it("exports a pending locale, which is the one most likely to need it", async () => {
    const compiler = make({ locales: ["en", "ar"], pendingLocales: ["de"] });
    await compiler.setup();
    await seed(compiler);

    expect(await exists(join(root, "l10n/de.xlf"))).toBe(true);
    expect(await readFile(join(root, "l10n/de.xlf"), "utf-8")).toContain(`trgLang="de"`);
  });

  /**
   * Source text is arbitrary user prose, and prose contains angle brackets and
   * ampersands. An unescaped one produces a file every TMS rejects.
   */
  it("escapes markup in the source text", async () => {
    const compiler = make();
    await compiler.setup();
    await mkdir(join(root, "src"), { recursive: true });
    await compiler.transform(
      `
        import { zintl, t } from "zintljs";
        zintl(navigator.language);
        console.log(t('Fish & chips <not a tag> "quoted"'));
      `,
      join(root, "src/main.ts"),
      "virtual:zintl/inject",
    );
    await compiler.flush();

    const xml = await read();
    expect(xml).toContain(`Fish &amp; chips &lt;not a tag&gt; &quot;quoted&quot;`);
    expect(xml).not.toContain(`<not a tag>`);
  });

  /**
   * A boundary id is a path and XLIFF types `id` as an NMTOKEN, which admits no
   * `/`. The readable spelling goes in `original`, which is the attribute XLIFF
   * has for it.
   */
  it("keeps the file id valid, and emits one file", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);

    const xml = await read();
    expect(xml).toMatch(/<file id="[A-Za-z0-9_.-]+">/);
    // A boundary id is a path, and XLIFF types `id` as an NMTOKEN.
    expect(xml).not.toMatch(/<file id="[^"]*\//);
    expect(xml.match(/<file /g)).toHaveLength(1);
  });

  /** A re-export with nothing changed is byte-identical, so a diff means something moved. */
  it("is stable across a re-export", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);
    const first = await read();

    await compiler.flush();
    expect(await read()).toBe(first);
  });
});
