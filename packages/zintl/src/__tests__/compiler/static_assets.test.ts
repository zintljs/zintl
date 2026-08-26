import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompilerWith } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { assetsFacet, type AssetManager } from "@zintljs/compiler/facets";
import { join } from "node:path";
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

/**
 * A targeted asset is **authored** per locale, never derived (proposal 035).
 *
 * These tests were written against the opposite model — frontmatter merging,
 * similarity scoring, "please re-translate" warnings, content restored from the
 * hive — and about half of them described machinery that existed only to carry
 * a source's content into a localized file. That is the defect rather than the
 * feature: a byte-identical artifact is a source-locale fallback nothing
 * downstream can detect, which is the one thing this project's first rule
 * forbids.
 *
 * What is asserted here now is the whole of the compiler's involvement: the slot
 * exists, it starts empty, an author's bytes are never touched, and a source
 * that moves takes its artifacts with it.
 */
describe("Zintl Compiler - Localized assets are authored", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-static-assets-test-");
    context.root = root;
    await mkdir(join(root, "src/docs"), { recursive: true });
    context.compiler = createTestCompilerWith(
      [assetsFacet()],
      {
        locales: ["en", "ar", "fr"],
        outputDir: "locales",
      },
      root,
      true,
    );
  });

  it("scaffolds an empty artifact per locale, for text and binary alike", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    await writeFile(join(root, "src/docs/about.md"), "---\ntitle: Original\n---\n# Heading");
    await writeFile(join(root, "src/docs/notice.txt"), "Hello world.");

    await compiler.discover();

    const registered = assets.getRegisteredAssets();
    expect(registered).toContain("src/docs/about.md");
    expect(registered).toContain("src/docs/notice.txt");

    await compiler.flush();

    for (const [id, locale] of [
      ["src/docs/about.md", "ar"],
      ["src/docs/about.md", "fr"],
      ["src/docs/notice.txt", "ar"],
    ] as const) {
      const path = assets.getAssetPath(id, locale);
      expect(existsSync(path)).toBe(true);
      // Empty, not a clone. A copy of the source here is the fallback.
      expect((await stat(path)).size).toBe(0);
    }

    // The source locale is never written: it is the file the author already has.
    expect(existsSync(assets.getAssetPath("src/docs/about.md", "en"))).toBe(false);
  });

  it("never overwrites what an author put in an artifact", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    await writeFile(join(root, "src/docs/about.md"), "---\ntitle: Welcome\n---\n# Welcome page");
    await compiler.discover();
    await compiler.flush();

    const arPath = assets.getAssetPath("src/docs/about.md", "ar");
    const authored = "---\ntitle: أهلاً بك\n---\n# صفحة الترحيب";
    await writeFile(arPath, authored);

    await compiler.discover();
    await compiler.flush();

    // Byte-for-byte. No frontmatter merged in from the source, no warning
    // prepended, nothing reconciled — the artifact is the author's file.
    expect(await readFile(arPath, "utf-8")).toBe(authored);
  });

  it("leaves artifacts alone when the source is edited in place", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    const sourcePath = join(root, "src/docs/about.md");
    await writeFile(sourcePath, "# Original heading\n\nA paragraph.");
    await compiler.discover();
    await compiler.flush();

    const arPath = assets.getAssetPath("src/docs/about.md", "ar");
    const authored = "# عنوان\n\nفقرة.";
    await writeFile(arPath, authored);

    // A rewrite large enough that similarity scoring would once have called it
    // "changed significantly" and replaced the Arabic with the English text.
    await writeFile(sourcePath, "# A completely different heading\n\nEntirely new prose here.");
    await compiler.discover();
    await compiler.flush();

    expect(await readFile(arPath, "utf-8")).toBe(authored);
  });

  it("prunes artifacts when the source asset is deleted", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    const txtPath = join(root, "src/docs/notice.txt");
    await writeFile(txtPath, "Original notice");

    await compiler.discover();
    await compiler.flush();

    const arPath = assets.getAssetPath("src/docs/notice.txt", "ar");
    const frPath = assets.getAssetPath("src/docs/notice.txt", "fr");
    expect(existsSync(arPath)).toBe(true);
    expect(existsSync(frPath)).toBe(true);

    await rm(txtPath);
    await compiler.discover();
    await compiler.flush();

    expect(existsSync(arPath)).toBe(false);
    expect(existsSync(frPath)).toBe(false);
  });

  it("follows a renamed source, carrying its artifacts with it", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    const before = join(root, "src/docs/notice.txt");
    await writeFile(before, "Original notice");
    await compiler.discover();
    await compiler.flush();

    const authored = "إشعار مترجم";
    const arBefore = assets.getAssetPath("src/docs/notice.txt", "ar");
    await writeFile(arBefore, authored);

    // Same bytes, new path: a move, and the one case identity tracking exists for.
    await mkdir(join(root, "src/legal"), { recursive: true });
    await writeFile(join(root, "src/legal/notice.txt"), "Original notice");
    await rm(before);

    await compiler.discover();
    await compiler.flush();

    const arAfter = assets.getAssetPath("src/legal/notice.txt", "ar");
    expect(await readFile(arAfter, "utf-8")).toBe(authored);
    expect(existsSync(arBefore)).toBe(false);
  });

  it("reports unfilled artifacts, empty or absent", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    await writeFile(join(root, "src/docs/notice.txt"), "Original notice");
    await compiler.discover();
    await compiler.flush();

    const locales = ["en", "ar", "fr"];
    const arPath = assets.getAssetPath("src/docs/notice.txt", "ar");
    const frPath = assets.getAssetPath("src/docs/notice.txt", "fr");

    // Both scaffolds are empty, and the source locale is never a slot to fill.
    expect((await assets.getUnfilledOutputs(locales)).map((u) => u.path).sort()).toEqual(
      [arPath, frPath].sort(),
    );

    await writeFile(arPath, "إشعار");
    expect(await assets.getUnfilledOutputs(locales)).toEqual([{ locale: "fr", path: frPath }]);

    // Deleted by hand is a slot to fill, not permission to ship the source.
    await rm(frPath);
    expect(await assets.getUnfilledOutputs(locales)).toEqual([{ locale: "fr", path: frPath }]);
  });

  it("records delivery from the import, and lets inline win", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    await writeFile(join(root, "src/docs/notice.txt"), "Original notice");
    await writeFile(join(root, "src/docs/about.md"), "# About");

    await assets.registerAsset(join(root, "src/docs/notice.txt"), "inline");
    await assets.registerAsset(join(root, "src/docs/about.md"), "reference");

    expect(assets.getDelivery("src/docs/notice.txt")).toBe("inline");
    expect(assets.getDelivery("src/docs/about.md")).toBe("reference");

    // A later plain import must not demote an asset something imports with `?raw`:
    // a URL cannot be turned back into the text that consumer needs.
    await assets.registerAsset(join(root, "src/docs/notice.txt"), "reference");
    expect(assets.getDelivery("src/docs/notice.txt")).toBe("inline");

    // A sighting that carries no import — a discovery walk, an HMR event —
    // never changes what an import already established.
    await assets.registerAsset(join(root, "src/docs/about.md"));
    expect(assets.getDelivery("src/docs/about.md")).toBe("reference");
  });

  it("contributes an empty catalog value for an unfilled inline asset", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
    const assets = compiler.assets as AssetManager;

    await writeFile(join(root, "src/docs/notice.txt"), "Original notice");
    await assets.registerAsset(join(root, "src/docs/notice.txt"), "inline");
    await compiler.flush();

    const key = "@zintl/asset:src/docs/notice.txt";

    // Never the source text. `""` is what `verifyIntegrity` already reads as
    // "missing", so an unfilled asset fails a build for the same reason a string
    // does rather than shipping English to a reader who asked for Arabic.
    expect((await assets.getAssetTranslations("ar"))[key]).toBe("");
    expect((await assets.getAssetTranslations("en"))[key]).toBe("Original notice");

    await writeFile(assets.getAssetPath("src/docs/notice.txt", "ar"), "إشعار");
    expect((await assets.getAssetTranslations("ar"))[key]).toBe("إشعار");
  });

  it("supports custom globs and output patterns", async (context: LocalContext) => {
    const root = context.root!;

    await mkdir(join(root, "src/docs"), { recursive: true });
    await mkdir(join(root, "src/public"), { recursive: true });

    await writeFile(join(root, "src/docs/intro.mdx"), "---\ntitle: Intro\n---\nHello MDX");
    await writeFile(join(root, "src/public/hero.png"), "FAKE_PNG_BINARY_DATA");

    const compiler = createTestCompilerWith(
      [
        assetsFacet({
          targets: [
            "md",
            {
              targetPattern: "src/docs/**/*.mdx",
              outputPattern: "locales/docs/[locale]/[name].mdx",
            },
            {
              targetPattern: "src/public/*.png",
              outputPattern: "locales/assets/[locale]/[name].[ext]",
            },
          ],
        }),
      ],
      {
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true,
    );

    await compiler.discover();
    await compiler.flush();

    const assets = compiler.assets as AssetManager;

    /**
     * `.mdx` and `.png` land where their patterns say, and both arrive empty.
     * No `strategy` names them, because no procedure distinguishes them: the
     * table that used to map `.md` to frontmatter merging and everything else to
     * byte-copying described how to build a copy, and nothing is copied.
     */
    const mdxArPath = assets.getAssetPath("src/docs/intro.mdx", "ar");
    expect(mdxArPath).toBe(join(root, "locales/docs/ar/intro.mdx"));
    expect((await stat(mdxArPath)).size).toBe(0);

    const pngArPath = assets.getAssetPath("src/public/hero.png", "ar");
    expect(pngArPath).toBe(join(root, "locales/assets/ar/hero.png"));
    expect((await stat(pngArPath)).size).toBe(0);
  });

  it("keeps assets out of the catalog namespace when catalogFormat is shared", async (context: LocalContext) => {
    const { root } = context;
    await mkdir(join(root, "src/assets"), { recursive: true });
    await writeFile(join(root, "src/assets/logo.png"), "LOGO_DATA");

    const compiler = createTestCompilerWith(
      [assetsFacet({ targets: ["png"] })],
      {
        locales: ["en", "ar"],
        outputDir: "locales",
        catalogFormat: "translations/[locale].json",
      },
      root,
      true,
    );

    await compiler.discover();
    await compiler.flush();

    const logoPath = (compiler.assets as AssetManager).getAssetPath("src/assets/logo.png", "ar");
    // The original path is carried into the artifact path, so two assets with
    // the same basename cannot collide under a shared catalog format.
    expect(logoPath).toBe(join(root, "locales/translations/src/assets/logo.ar.png"));
    expect((await stat(logoPath)).size).toBe(0);
  });

  it("declares the extensions its targets statically claim", async () => {
    const declared = (config?: Parameters<typeof assetsFacet>[0]) =>
      (assetsFacet(config) as { extensions?: string[] }).extensions;

    expect(declared()).toEqual([".md", ".txt"]);
    // A pattern with no static extension declares nothing and stays `match`'s
    // business, which is what keeps the declaration honest rather than generous.
    expect(declared({ targets: ["rst", "**/*.adoc", "docs/**/*"] })).toEqual([".rst", ".adoc"]);
  });
});
