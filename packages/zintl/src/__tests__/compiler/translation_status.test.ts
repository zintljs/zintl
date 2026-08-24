/**
 * Per-locale translation completeness while serving.
 *
 * The gate tells you at build time, in full, and refuses. That is correct and
 * it is also late: the first time a team hears about a missing translation
 * should not be CI going red on a Friday. This is the number in between —
 * visible on every dev flush, moving as translators fill catalogs in.
 *
 * Counted against the hive on purpose, because that is what `verifyIntegrity`
 * accepts. A status that could read "complete" while the build fails would be
 * worse than no status at all.
 */
import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { createTestCompiler } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

const byLocale = (compiler: ZintlCompiler) =>
  Object.fromEntries(
    compiler.getTranslationStatus().map((s) => [s.locale, `${s.translated}/${s.total}`]),
  );

async function seed(compiler: ZintlCompiler, root: string) {
  await mkdir(join(root, "src"), { recursive: true });
  await compiler.transform(
    `
      import { zintl, t } from "zintljs";
      zintl(navigator.language);
      console.log(t("Welcome back!"), t("Sign out"), t("Settings"));
    `,
    join(root, "src/main.ts"),
    "virtual:zintl/inject",
  );
  await compiler.flush();
}

describe("Translation status", () => {
  let compiler: ZintlCompiler;
  let root: string;

  beforeEach(async (context: LocalContext) => {
    root = await createTestDir("zintl-translation-status-");
    context.root = root;
    compiler = createTestCompiler(
      {
        locales: ["en", "ar", "fr"],
        sourceLocale: "en",
        outputDir: "zintl",
        logLevel: "silent",
        verifyIntegrity: false,
      },
      root,
      true, // serving — where this number is both true and interesting
    );
    await compiler.setup();
  });

  it("counts every extracted string as untranslated on a fresh project", async () => {
    await seed(compiler, root);
    expect(byLocale(compiler)).toEqual({ ar: "0/3", fr: "0/3" });
  });

  /**
   * The source locale is never written to disk and is translated by
   * definition, so counting it would report a permanent 0/N that means nothing.
   */
  it("leaves the source locale out of the report", async () => {
    await seed(compiler, root);
    expect(compiler.getTranslationStatus().map((s) => s.locale)).toEqual(["ar", "fr"]);
  });

  it("moves as translations arrive, per locale", async () => {
    await seed(compiler, root);

    compiler.messages.hive["ar"] = { "Welcome back!": "مرحبا بعودتك", "Sign out": "تسجيل الخروج" };
    compiler.messages.hive["fr"] = { "Welcome back!": "Bon retour" };

    expect(byLocale(compiler)).toEqual({ ar: "2/3", fr: "1/3" });
  });

  /**
   * The number has to agree with the gate. An empty string is what an
   * unfilled catalog entry looks like, and `verifyIntegrity` rejects it — so
   * counting it as translated would let the status read complete on a build
   * that is about to fail.
   */
  it("does not count an empty translation as done", async () => {
    await seed(compiler, root);
    compiler.messages.hive["ar"] = { "Welcome back!": "", "Sign out": "تسجيل الخروج" };

    expect(byLocale(compiler)).toEqual({ ar: "1/3", fr: "0/3" });
  });

  it("reports complete once every key is covered", async () => {
    await seed(compiler, root);
    compiler.messages.hive["ar"] = { "Welcome back!": "a", "Sign out": "b", Settings: "c" };

    expect(byLocale(compiler).ar).toBe("3/3");
  });

  /**
   * Severity tracks consequence.
   *
   * An incomplete locale is a build that is going to fail, so it belongs at
   * `warn`. At `info` it is the first line to vanish for anyone running
   * `logLevel: "warn"` — a common choice in CI — who would keep every line they
   * did not care about and lose the one that predicts the failure.
   */
  describe("severity", () => {
    const report = () => {
      const warn = vi.spyOn(compiler._logger, "warn").mockImplementation(() => {});
      const info = vi.spyOn(compiler._logger, "info").mockImplementation(() => {});
      (compiler as unknown as { reportTranslationStatus(): void }).reportTranslationStatus();
      const result = {
        warn: warn.mock.calls.map((c) => String(c[0])),
        info: info.mock.calls.map((c) => String(c[0])),
      };
      warn.mockRestore();
      info.mockRestore();
      return result;
    };

    it("warns while anything is missing, and says what it will cost", async () => {
      await seed(compiler, root);
      compiler.messages.hive["ar"] = { "Welcome back!": "a" };

      const { warn, info } = report();
      expect(info).toEqual([]);
      expect(warn).toHaveLength(1);
      expect(warn[0]).toContain("ar 1/3");
      expect(warn[0]).toContain("5 missing");
      // The consequence is the justification for the level, so it is stated.
      expect(warn[0]).toContain("production build will fail");
    });

    it("drops to info once every locale is complete", async () => {
      await seed(compiler, root);
      const full = { "Welcome back!": "a", "Sign out": "b", Settings: "c" };
      compiler.messages.hive["ar"] = { ...full };
      compiler.messages.hive["fr"] = { ...full };

      const { warn, info } = report();
      expect(warn).toEqual([]);
      expect(info).toHaveLength(1);
      expect(info[0]).toContain("complete");
    });

    it("says nothing at all when the counts have not moved", async () => {
      await seed(compiler, root);
      report();
      const { warn, info } = report();
      expect([...warn, ...info]).toEqual([]);
    });
  });
});
