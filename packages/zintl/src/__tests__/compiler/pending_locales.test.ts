/**
 * A locale that is maintained but never shipped (proposal 031).
 *
 * The situation this exists for is narrow and specific: a team adds German,
 * German is 0% translated and will be for a month, and every build in between
 * is red. The two pre-existing answers were both wrong — keeping `de` out of
 * `locales` leaves translators with no files to fill, and `verifyIntegrity:
 * false` removes the gate from `ar` and `fr`, which have real users.
 *
 * So the claim under test is a pair, and neither half is interesting alone:
 * a pending locale is maintained *exactly* like a shipped one on disk, and
 * reaches production *nowhere*. The no-fallback rule is untouched because
 * nothing renders in German at all until it is promoted.
 */
import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { createTestCompiler, createTestCompilerWith } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { assetsFacet, type AssetManager } from "@zintljs/compiler/facets";
import { join } from "node:path";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/** Three strings behind one runtime-switchable anchor. */
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
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const thrownBy = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: Error) => e,
  );

describe("Pending locales", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-pending-locales-");
  });

  /**
   * Every one of these is quiet if it is allowed through, which is the whole
   * reason they are refused at construction rather than at a read site.
   */
  describe("configuration", () => {
    const construct = (options: Record<string, unknown>, root: string) => () =>
      createTestCompiler(
        { sourceLocale: "en", outputDir: "locales", logLevel: "silent", ...options },
        root,
        true,
      );

    it("refuses a locale that is both shipped and pending", (context: LocalContext) => {
      const make = construct(
        { locales: ["en", "ar", "de"], pendingLocales: ["de"] },
        context.root as string,
      );
      expect(make).toThrow(/"de" is in both `locales` and `pendingLocales`/);
      // The distinction is the whole feature, so the message states it.
      expect(make).toThrow(/either shipped or being stood up/);
    });

    it("refuses a pending source locale", (context: LocalContext) => {
      const make = construct(
        { locales: ["en", "ar"], pendingLocales: ["en"] },
        context.root as string,
      );
      expect(make).toThrow(/`sourceLocale` \("en"\) cannot be pending/);
      // Because it is diskless, not because of a rule someone invented.
      expect(make).toThrow(/never gets a catalog on\ndisk/);
    });

    it("refuses a duplicate in either list", (context: LocalContext) => {
      expect(construct({ locales: ["en", "ar", "ar"] }, context.root as string)).toThrow(
        /`locales` lists "ar" more than once/,
      );
      expect(
        construct({ locales: ["en"], pendingLocales: ["de", "de"] }, context.root as string),
      ).toThrow(/`pendingLocales` lists "de" more than once/);
    });

    it("accepts a project with no pending locales at all", (context: LocalContext) => {
      expect(construct({ locales: ["en", "ar"] }, context.root as string)).not.toThrow();
    });
  });

  /**
   * The maintained half. A translator cannot start without a file, so this is
   * the difference between the feature and simply leaving `de` out of the
   * config.
   */
  describe("is maintained on disk", () => {
    const make = (root: string, isDev = true) =>
      createTestCompiler(
        {
          locales: ["en", "ar"],
          pendingLocales: ["de"],
          sourceLocale: "en",
          outputDir: "locales",
          logLevel: "silent",
          verifyIntegrity: false,
        },
        root,
        isDev,
      );

    it("writes a catalog for the pending locale, at 0% translated", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = make(root);
      await compiler.setup();
      await seed(compiler, root);
      await compiler.flush();

      const path = join(root, "locales/src/main.de.json");
      expect(await exists(path)).toBe(true);

      // Every key present and empty — the shape a translator opens.
      const catalog = JSON.parse(await readFile(path, "utf-8"));
      expect(catalog["Welcome back!"]).toBe("");
      expect(catalog["Sign out"]).toBe("");
      expect(catalog["Settings"]).toBe("");
    });

    /**
     * The destructive case, and the one thing in 031 that can lose work.
     *
     * Pruning deletes what it does not recognize. Handed the shipped list it
     * would classify a pending locale's catalog as an orphan, and a production
     * build would silently delete a month of half-finished translation.
     */
    it("does not prune a pending locale's catalog", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = make(root, false); // build mode — where pruning runs
      await compiler.setup();
      await seed(compiler, root);
      await compiler.flush();

      const path = join(root, "locales/src/main.de.json");
      await writeFile(
        path,
        JSON.stringify({ "Welcome back!": "Willkommen zurück", "Sign out": "", Settings: "" }),
      );

      /**
       * A source edit that actually grows the boundary graph, and it is
       * load-bearing rather than scenery.
       *
       * `pruneOrphanedBoundaries` returns early when the manifest hash — the
       * graph's node keys — is unchanged, so a second identical flush prunes
       * nothing and this test would pass without running the code it names.
       * Measured, not assumed: with the shipped list in place of the maintained
       * one, this shape deletes `locales/src/main.de.json` outright, and an
       * unreferenced new file does not.
       */
      await compiler.transform(
        `
          import { zintl, t } from "zintljs";
          import { extra } from "./extra.ts";
          zintl(navigator.language);
          console.log(t("Welcome back!"), t("Sign out"), t("Settings"), extra());
        `,
        join(root, "src/main.ts"),
        "virtual:zintl/inject",
      );
      await compiler.transform(
        `
          import { t } from "zintljs";
          export const extra = () => t("Profile");
        `,
        join(root, "src/extra.ts"),
        "virtual:zintl/inject",
      );
      await compiler.flush();

      expect(await exists(path)).toBe(true);
      const catalog = JSON.parse(await readFile(path, "utf-8"));
      expect(catalog["Welcome back!"]).toBe("Willkommen zurück");
    });
  });

  /**
   * The gate. Incompleteness is the expected state of a pending locale, so
   * gating it would reinstate exactly the red build this removes — while the
   * shipped locales stay gated, which is the half `verifyIntegrity: false`
   * throws away.
   */
  describe("verifyIntegrity", () => {
    const make = (root: string, options: Record<string, unknown>) =>
      createTestCompiler(
        {
          sourceLocale: "en",
          outputDir: "locales",
          logLevel: "silent",
          verifyIntegrity: true,
          ...options,
        },
        root,
        false, // build mode
      );

    it("passes a build with a 0%-translated pending locale", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = make(root, { locales: ["en"], pendingLocales: ["de"] });
      await compiler.setup();
      await seed(compiler, root);

      await expect(compiler.flush()).resolves.toBeUndefined();
    });

    it("still fails for a shipped locale, with the pending one absent from the report", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = make(root, { locales: ["en", "ar"], pendingLocales: ["de"] });
      await compiler.setup();
      await seed(compiler, root);

      const error = await thrownBy(compiler.flush());
      expect(error).toBeDefined();

      const message = error!.message;
      expect(message).toContain("3 missing translations across 1 locale");
      // One locale, not two: `de` is maintained, and not the build's problem.
      expect(message).toContain("ar — 3 missing");
      expect(message).not.toContain("de — ");
      expect(message).not.toContain("main.de.json");
    });

    /**
     * The asset half of the same rule (035 §5.1). An unfilled artifact is a
     * missing translation with a file for a body, and a pending locale's slot
     * is expected to be empty for the same reason its catalog is.
     */
    describe("unfilled localized assets", () => {
      const makeAssetCompiler = (root: string, options: Record<string, unknown>) =>
        createTestCompilerWith(
          [assetsFacet({ targets: ["txt"] })],
          {
            sourceLocale: "en",
            outputDir: "locales",
            logLevel: "silent",
            verifyIntegrity: true,
            ...options,
          },
          root,
          false,
        );

      async function seedAsset(compiler: ZintlCompiler, root: string) {
        await mkdir(join(root, "src"), { recursive: true });
        await writeFile(join(root, "src/about.txt"), "Hello world.");
        await compiler.transform(
          `
            import { zintl } from "zintljs";
            import about from "./about.txt?raw";
            zintl(navigator.language);
            console.log(about);
          `,
          join(root, "src/main.ts"),
          "virtual:zintl/inject",
        );
        await (compiler.assets as AssetManager).registerAsset(
          join(root, "src/about.txt"),
          "inline",
        );
      }

      it("does not gate a pending locale's empty artifact", async (context: LocalContext) => {
        const root = context.root as string;
        const compiler = makeAssetCompiler(root, { locales: ["en"], pendingLocales: ["de"] });
        await compiler.setup();
        await seedAsset(compiler, root);

        await expect(compiler.flush()).resolves.toBeUndefined();
      });

      it("still gates a shipped locale's empty artifact", async (context: LocalContext) => {
        const root = context.root as string;
        const compiler = makeAssetCompiler(root, {
          locales: ["en", "ar"],
          pendingLocales: ["de"],
        });
        await compiler.setup();
        await seedAsset(compiler, root);

        const error = await thrownBy(compiler.flush());
        expect(error).toBeDefined();
        expect(error!.message).toContain("locales/src/about.ar.txt");
        expect(error!.message).not.toContain("about.de.txt");
      });
    });
  });

  /**
   * The shipping half, and the half a snapshot of `dist` can only corroborate
   * after the fact.
   *
   * A catalog chunk exists because the generated Manager imports it. Nothing
   * suppresses a pending locale's chunk separately — the locale is simply
   * absent from the switch, so nothing imports it and the bundler has no
   * module to emit. Asserting on the Manager is asserting on the cause.
   */
  describe("is not shipped", () => {
    it("emits no catalog chunk for the pending locale", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = createTestCompiler(
        {
          locales: ["en", "ar"],
          pendingLocales: ["de"],
          sourceLocale: "en",
          outputDir: "locales",
          logLevel: "silent",
          verifyIntegrity: false,
        },
        root,
        false, // production — where chunks are decided
      );
      await compiler.setup();
      await seed(compiler, root);
      await compiler.flush();

      const mod = await compiler.generateVirtualModule("entry:src/main", "en", true);

      // The shipped locale is reachable...
      expect(mod.code).toContain('case "ar"');
      expect(mod.code).toContain("virtual:zintl/content/ar/");

      // ...and German is not in the switch at all, so nothing imports it.
      expect(mod.code).not.toContain('case "de"');
      expect(mod.code).not.toContain("virtual:zintl/content/de/");
    });
  });

  /**
   * An anchor on a pending locale is a different mistake from an anchor on an
   * unknown one. Both are refused; telling the first author to "add the locale
   * to `locales`" would be advice to ship German blank.
   */
  describe("a zintl() literal naming a pending locale", () => {
    it("names it as pending, and offers promotion rather than addition", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = createTestCompiler(
        {
          locales: ["en", "ar"],
          pendingLocales: ["de"],
          sourceLocale: "en",
          outputDir: "locales",
          logLevel: "silent",
          verifyIntegrity: true,
        },
        root,
        false,
      );
      await compiler.setup();
      await mkdir(join(root, "src"), { recursive: true });
      await compiler.transform(
        `
          import { zintl, t } from "zintljs";
          zintl("de");
          console.log(t("Welcome back!"));
        `,
        join(root, "src/main.ts"),
        "virtual:zintl/inject",
      );

      const error = await thrownBy(compiler.flush());
      expect(error).toBeDefined();
      const message = error!.message;

      // "you do not build" would be false: German is built, just not shipped.
      expect(message).toContain("zintl() targets 1 locale you do not ship yet");
      expect(message).toContain("Pending locales: [de]");
      expect(message).toContain('"de" — pending, anchored in:');
      expect(message).toContain("A pending locale is maintained but never rendered");
      expect(message).toContain("move it from `pendingLocales` to `locales`");

      // Not the advice for an unknown locale, which would be advice to ship blank.
      expect(message).not.toContain("add the locale to `locales`");
    });

    it("still reports an unknown locale as unknown", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = createTestCompiler(
        {
          locales: ["en", "ar"],
          pendingLocales: ["de"],
          sourceLocale: "en",
          outputDir: "locales",
          logLevel: "silent",
          verifyIntegrity: true,
        },
        root,
        false,
      );
      await compiler.setup();
      await mkdir(join(root, "src"), { recursive: true });
      await compiler.transform(
        `
          import { zintl, t } from "zintljs";
          zintl("zz");
          console.log(t("Welcome back!"));
        `,
        join(root, "src/main.ts"),
        "virtual:zintl/inject",
      );

      const error = await thrownBy(compiler.flush());
      expect(error).toBeDefined();
      expect(error!.message).toContain("zintl() targets 1 locale you do not build");
      expect(error!.message).toContain("add the locale to `locales`");
      expect(error!.message).not.toContain("pending, anchored in");
    });
  });

  /**
   * Progress is the point. A team standing up German watches this number for a
   * month, and it is what makes promotion a non-event.
   */
  describe("status", () => {
    const make = (root: string) =>
      createTestCompiler(
        {
          locales: ["en", "ar"],
          pendingLocales: ["de"],
          sourceLocale: "en",
          outputDir: "locales",
          logLevel: "silent",
          verifyIntegrity: false,
        },
        root,
        true, // serving — where the number is both true and interesting
      );

    it("counts the pending locale, marked as pending", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = make(root);
      await compiler.setup();
      await seed(compiler, root);

      expect(compiler.getTranslationStatus()).toEqual([
        { locale: "ar", translated: 0, total: 3, pending: false },
        { locale: "de", translated: 0, total: 3, pending: true },
      ]);
    });

    const report = (compiler: ZintlCompiler) => {
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

    /**
     * Severity tracks consequence, and a pending gap has none: the build
     * passes. Warning about it would be false, and would train people to
     * ignore the line that does predict a failure.
     */
    it("does not warn when only the pending locale is incomplete", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = make(root);
      await compiler.setup();
      await seed(compiler, root);
      compiler.messages.hive["ar"] = {
        "Welcome back!": "a",
        "Sign out": "b",
        Settings: "c",
      };

      const { warn, info } = report(compiler);
      expect(warn).toEqual([]);
      expect(info).toHaveLength(1);
      expect(info[0]).toContain("ar 3/3");
      expect(info[0]).toContain("de 0/3 (pending)");
      expect(info[0]).toContain("shipped locales complete; de is not shipped yet");
    });

    it("warns for a shipped gap, counting only the shipped locale's misses", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = make(root);
      await compiler.setup();
      await seed(compiler, root);
      compiler.messages.hive["ar"] = { "Welcome back!": "a" };

      const { warn, info } = report(compiler);
      expect(info).toEqual([]);
      expect(warn).toHaveLength(1);
      // Two, not five: `de`'s three gaps are not a coming failure.
      expect(warn[0]).toContain("2 missing");
      expect(warn[0]).toContain("de 0/3 (pending)");
      expect(warn[0]).toContain("production build will fail");
    });
  });
});
