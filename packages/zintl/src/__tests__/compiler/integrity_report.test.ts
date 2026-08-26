/**
 * Integrity reporting: one error for the whole failure set.
 *
 * The rule under test is not "a missing translation fails the build" — that has
 * always held. It is that the failure is announced *once*, in full. The check
 * used to throw on the first missing key, so a project adopting Zintl found its
 * N missing translations across N builds, which is the worst possible shape for
 * the first build a new user ever runs.
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler, createTestCompilerWith } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { assetsFacet, type AssetManager } from "@zintljs/compiler/facets";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/** Three strings in two files, behind one runtime-switchable anchor. */
async function seedProject(compiler: ZintlCompiler, root: string) {
  await mkdir(join(root, "src"), { recursive: true });

  await compiler.transform(
    `
      import { zintl, t } from "zintljs";
      import { nav } from "./nav.ts";
      zintl(navigator.language);
      console.log(t("Welcome back!"), t("Sign out"), nav());
    `,
    join(root, "src/main.ts"),
    "virtual:zintl/inject",
  );

  await compiler.transform(
    `
      import { t } from "zintljs";
      export const nav = () => t("Settings");
    `,
    join(root, "src/nav.ts"),
    "virtual:zintl/inject",
  );
}

function makeCompiler(root: string, locales: string[]) {
  return createTestCompiler(
    {
      locales,
      sourceLocale: "en",
      outputDir: "locales",
      logLevel: "silent",
      verifyIntegrity: true,
    },
    root,
    false, // build mode — the translation check is skipped in dev by design
  );
}

describe("Integrity reporting", () => {
  beforeEach(async (context: LocalContext) => {
    context.root = await createTestDir("zintl-integrity-report-");
  });

  it("reports every missing translation in one error, not the first one", async (context: LocalContext) => {
    const root = context.root as string;
    const compiler = makeCompiler(root, ["en", "ar", "fr"]);
    await compiler.setup();
    await seedProject(compiler, root);

    const error = await compiler.flush().then(
      () => undefined,
      (e: Error) => e,
    );

    expect(error).toBeDefined();
    const message = error!.message;

    // Three strings × two non-source locales — the whole set, counted up front.
    expect(message).toContain("[Zintl Integrity Error] 6 missing translations across 2 locales");

    // Every key named, not just whichever the traversal reached first.
    expect(message).toContain('"Welcome back!"');
    expect(message).toContain('"Sign out"');
    expect(message).toContain('"Settings"');

    // And a way out that does not require reading the source.
    expect(message).toContain("verifyIntegrity: false");
  });

  it("collapses to one listing when every locale is missing the same strings", async (context: LocalContext) => {
    const root = context.root as string;
    const compiler = makeCompiler(root, ["en", "ar", "fr", "zh"]);
    await compiler.setup();
    await seedProject(compiler, root);

    const error = await compiler.flush().then(
      () => undefined,
      (e: Error) => e,
    );

    expect(error).toBeDefined();
    const message = error!.message;

    // The fresh-adoption shape: named once, with the diagnosis stated.
    expect(message).toContain("Every locale (ar, fr, zh) is missing the same 3 strings");
    expect(message).toContain("have most likely not been filled in yet");

    // Said once, not once per locale — the whole point of the collapsed shape.
    expect(message.match(/"Welcome back!"/g)).toHaveLength(1);

    // The concrete catalogs are still spelled out, one per locale.
    expect(message).toContain("Each file needs one catalog per locale");
  });

  /**
   * An unfilled asset is a missing translation with a file for a body.
   *
   * Same gate and same option as the strings above, because §5.1 of proposal
   * 035 makes it the same rule: `verifyIntegrity` already reads
   * `translation === ""` as missing, and `size === 0` is that statement about a
   * file. The report is its own, because the remedies differ — and the second
   * one is the point.
   */
  describe("unfilled localized assets", () => {
    const makeAssetCompiler = (root: string) =>
      createTestCompilerWith(
        [assetsFacet({ targets: ["txt"] })],
        {
          locales: ["en", "ar", "fr"],
          sourceLocale: "en",
          outputDir: "locales",
          logLevel: "silent",
          verifyIntegrity: true,
        },
        root,
        false, // build mode
      );

    /**
     * An anchor, and an asset reachable from it.
     *
     * The anchor is load-bearing rather than scenery: an asset no boundary can
     * reach is not localized at all, so a fixture without one gates nothing and
     * would pass for the wrong reason.
     */
    async function seedAssetProject(compiler: ZintlCompiler, root: string) {
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

      await (compiler.assets as AssetManager).registerAsset(join(root, "src/about.txt"), "inline");
    }

    it("fails the build, naming every empty artifact and both ways out", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = makeAssetCompiler(root);
      await compiler.setup();
      await seedAssetProject(compiler, root);

      const error = await compiler.flush().then(
        () => undefined,
        (e: Error) => e,
      );

      expect(error).toBeDefined();
      const message = error!.message;

      expect(message).toContain("[Zintl Integrity Error] 2 unfilled localized assets");
      expect(message).toContain("locales/src/about.ar.txt");
      expect(message).toContain("locales/src/about.fr.txt");

      // Why it is empty rather than a copy, stated where somebody meets it.
      expect(message).toContain("not a German PDF");

      // Both remedies. The second is correct and complete for anybody whose
      // asset was never meant to vary by locale — not a workaround.
      expect(message).toContain("fill the files above");
      expect(message).toContain("stop targeting the asset");
    });

    it("passes once every artifact has bytes", async (context: LocalContext) => {
      const root = context.root as string;
      const compiler = makeAssetCompiler(root);
      await compiler.setup();
      await seedAssetProject(compiler, root);

      const assets = compiler.assets as AssetManager;
      await writeFile(assets.getAssetPath("src/about.txt", "ar"), "مرحباً");
      await writeFile(assets.getAssetPath("src/about.txt", "fr"), "Bonjour");

      await expect(compiler.flush()).resolves.toBeUndefined();
    });
  });

  it("reports an anchor on an unbuilt locale instead of the downstream misses", async (context: LocalContext) => {
    const root = context.root as string;
    const compiler = makeCompiler(root, ["en", "ar"]);
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

    const error = await compiler.flush().then(
      () => undefined,
      (e: Error) => e,
    );

    expect(error).toBeDefined();
    const message = error!.message;

    expect(message).toContain("zintl() targets 1 locale you do not build");
    expect(message).toContain('"de"');
    expect(message).toContain("Configured locales: [en, ar]");

    // The config error stands alone: a locale nobody builds makes every
    // downstream missing translation a consequence rather than a finding.
    expect(message).not.toContain("missing translations");
  });
});
