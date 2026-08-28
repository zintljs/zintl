/**
 * Taking translations back (proposal 032 §7 step 4).
 *
 * The claim under test is that import is a **gate, not a merge**. Everything
 * arriving is a proposal from a system Zintl does not control, and most of
 * these tests are about refusal — which is the point. A merge that accepts
 * whatever it is handed would put a corrupted string in front of a user, and
 * the catalogs have had no validation at all until now.
 *
 * The other half is §8.2, decided rather than discovered: only an **approved**
 * translation is imported. A graded state entering a binary system would make a
 * passing `verifyIntegrity` stop meaning "this locale is done", which is the
 * only reason the gate is worth having.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompilerWith } from "../helpers/compiler.js";
import { xliffFacet } from "@zintljs/compiler/facets";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("XLIFF import", () => {
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-xliff-import-");
    context.root = root;
  });

  function make(isDev = false) {
    return createTestCompilerWith(
      [xliffFacet()],
      {
        locales: ["en", "ar"],
        sourceLocale: "en",
        outputDir: "zintl",
        logLevel: "silent",
        verifyIntegrity: false,
      },
      root,
      isDev,
    );
  }

  /** Two strings, one of them with a placeholder and a plural. */
  async function seed(compiler: ZintlCompiler) {
    await mkdir(join(root, "src"), { recursive: true });
    await compiler.transform(
      `
        import { zintl, t } from "zintljs";
        zintl(navigator.language);
        export const App = ({ user }) => (
          <div>
            <button>Save changes</button>
            <h1>Welcome back, {user.firstName}!</h1>
          </div>
        );
      `,
      join(root, "src/App.tsx"),
      "virtual:zintl/inject",
    );
    await compiler.flush();
  }

  /** What a translation system hands back. Written by hand, as one would be. */
  async function returnFromTms(units: { source: string; target: string; state?: string }[]) {
    await mkdir(join(root, "l10n"), { recursive: true });
    const body = units
      .map(
        (u, i) =>
          `    <unit id="u${i}">\n` +
          `      <segment state="${u.state ?? "final"}">\n` +
          `        <source>${u.source}</source>\n` +
          `        <target>${u.target}</target>\n` +
          `      </segment>\n` +
          `    </unit>`,
      )
      .join("\n");
    await writeFile(
      join(root, "l10n/ar.xlf"),
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="ar">\n` +
        `  <file id="zintl">\n${body}\n  </file>\n</xliff>\n`,
      "utf-8",
    );
  }

  const thrown = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (e: Error) => e,
    );

  it("accepts an approved translation and puts it in a catalog", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);
    await returnFromTms([{ source: "Save changes", target: "حفظ التغييرات" }]);
    await compiler.flush();

    expect(compiler.messages.hive["ar"]?.["Save changes"]).toBe("حفظ التغييرات");

    // And it reaches the JSON a developer commits, not just the in-memory hive.
    const catalogs = await readdir(join(root, "zintl/src"));
    const ar = catalogs.find((f) => f.endsWith(".ar.json"))!;
    expect(await readFile(join(root, "zintl/src", ar), "utf-8")).toContain("حفظ التغييرات");
  });

  it("accepts `reviewed` as well as `final`", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);
    await returnFromTms([{ source: "Save changes", target: "حفظ التغييرات", state: "reviewed" }]);
    await compiler.flush();

    expect(compiler.messages.hive["ar"]?.["Save changes"]).toBe("حفظ التغييرات");
  });

  /**
   * §8.2, and the reason the gate means anything. `translated` is the draft a
   * reviewer has not seen; letting it through would put unreviewed text in
   * front of users while `verifyIntegrity` reported the locale complete.
   */
  it("does not import a translation nobody has approved", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);
    await returnFromTms([
      { source: "Save changes", target: "حفظ التغييرات", state: "translated" },
      { source: "Save changes", target: "لا", state: "initial" },
    ]);
    await compiler.flush();

    expect(compiler.messages.hive["ar"]?.["Save changes"]).toBeUndefined();
  });

  it("writes nothing while serving", async () => {
    const compiler = make(true);
    await compiler.setup();
    await seed(compiler);
    await returnFromTms([{ source: "Save changes", target: "حفظ التغييرات" }]);
    await compiler.flush();

    expect(compiler.messages.hive["ar"]?.["Save changes"]).toBeUndefined();
  });

  describe("refuses what would render wrong", () => {
    it("fails the build, naming the string and the fault", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);
      await returnFromTms([{ source: "Welcome back, {user_firstName}!", target: "مرحباً بعودتك!" }]);

      const error = await thrown(compiler.flush());
      expect(error).toBeDefined();
      expect(error!.message).toContain("[Zintl Import Error]");
      expect(error!.message).toContain("{user_firstName}");
      expect(error!.message).toContain("missing from the translation");
    });

    /**
     * A partial import is worse than none: it leaves the project in a state
     * neither the repo nor the translation system believes in, with nothing
     * recording which half landed.
     */
    it("merges nothing at all, not even the units that were fine", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);
      await returnFromTms([
        { source: "Save changes", target: "حفظ التغييرات" },
        { source: "Welcome back, {user_firstName}!", target: "مرحباً!" },
      ]);

      expect(await thrown(compiler.flush())).toBeDefined();
      expect(compiler.messages.hive["ar"]?.["Save changes"]).toBeUndefined();
    });

    /**
     * The importer's own limit, reported rather than guessed at. Zintl escapes
     * markup into text when it writes, so a surviving `<` means the other
     * system used XLIFF inline elements — a shape this reader cannot rebuild.
     */
    it("says so when the segment uses inline elements it cannot read", async () => {
      const compiler = make();
      await compiler.setup();
      await seed(compiler);
      await mkdir(join(root, "l10n"), { recursive: true });
      await writeFile(
        join(root, "l10n/ar.xlf"),
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="ar">\n` +
          `  <file id="zintl"><unit id="u0"><segment state="final">` +
          `<source>Save changes</source><target><pc id="1">حفظ</pc></target>` +
          `</segment></unit></file>\n</xliff>\n`,
        "utf-8",
      );

      const error = await thrown(compiler.flush());
      expect(error).toBeDefined();
      expect(error!.message).toContain("inline elements");
      expect(error!.message).toContain("does not read");
    });
  });

  /**
   * The normal state of affairs half an hour after anyone edits a string.
   * Failing here would mean every source edit breaks the next import.
   */
  it("skips a string the source no longer has, without failing", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);
    await returnFromTms([
      { source: "Save changes", target: "حفظ التغييرات" },
      { source: "A string that was deleted last week", target: "شيء" },
    ]);

    await expect(compiler.flush()).resolves.toBeUndefined();
    expect(compiler.messages.hive["ar"]?.["Save changes"]).toBe("حفظ التغييرات");
    expect(compiler.messages.hive["ar"]?.["A string that was deleted last week"]).toBeUndefined();
  });

  /**
   * An approved translation is the reviewed answer, and round-tripping it is
   * the point of the loop — so it wins. The overwrite is logged with both
   * values, because a developer who hand-edited that catalog should find out
   * from the build rather than from a diff.
   */
  it("overwrites a local value and reports what it replaced", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);
    compiler.messages.hive["ar"] = { "Save changes": "القديم" };

    const said: string[] = [];
    const original = compiler._logger.info.bind(compiler._logger);
    compiler._logger.info = (msg: string) => {
      said.push(String(msg));
      original(msg);
    };

    await returnFromTms([{ source: "Save changes", target: "الجديد" }]);
    await compiler.flush();

    expect(compiler.messages.hive["ar"]["Save changes"]).toBe("الجديد");
    expect(said.some((m) => m.includes("القديم") && m.includes("الجديد"))).toBe(true);
  });

  /** Export then import, with nothing in between, changes nothing. */
  it("round-trips its own output without drift", async () => {
    const compiler = make();
    await compiler.setup();
    await seed(compiler);

    const exported = await readFile(join(root, "l10n/ar.xlf"), "utf-8");
    await expect(compiler.flush()).resolves.toBeUndefined();
    expect(await readFile(join(root, "l10n/ar.xlf"), "utf-8")).toBe(exported);
  });
});
