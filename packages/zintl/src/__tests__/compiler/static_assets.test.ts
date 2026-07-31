import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompilerWith } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { assetsFacet } from "@zintljs/compiler/facets";
import { join } from "node:path";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Zintl Compiler - Static Content Files (Markdown & Text)", () => {
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

  it("should discover and sync markdown and text assets", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const mdContent = `---
title: Original Title
category: Help
---
# Heading
This is a paragraph.`;

    const txtContent = `Hello world.
This is plain text.`;

    const mdPath = join(root, "src/docs/about.md");
    const txtPath = join(root, "src/docs/notice.txt");

    await writeFile(mdPath, mdContent);
    await writeFile(txtPath, txtContent);

    // Run discovery
    await compiler.discover();

    // Verify assets registered
    const assets = compiler.assets.getRegisteredAssets();
    expect(assets).toContain("src/docs/about.md");
    expect(assets).toContain("src/docs/notice.txt");

    // Flush to generate translations
    await compiler.flush();

    // Verify correct target file paths are generated
    const mdArPath = compiler.assets.getAssetPath("src/docs/about.md", "ar");
    const txtArPath = compiler.assets.getAssetPath("src/docs/notice.txt", "ar");

    expect(mdArPath).toContain("locales/src/docs/about.ar.md");
    expect(txtArPath).toContain("locales/src/docs/notice.ar.txt");

    // Verify generated content (initially a clean clone)
    const mdArContent = await readFile(mdArPath, "utf-8");
    expect(mdArContent).toContain("title: Original Title");
    expect(mdArContent).toContain("category: Help");
    expect(mdArContent).toContain("# Heading\nThis is a paragraph.");

    const txtArContent = await readFile(txtArPath, "utf-8");
    expect(txtArContent).toContain("Hello world.\nThis is plain text.");

    // Test getTranslationOnly returns translation as-is
    const mdStripped = compiler.assets.getTranslationOnly(mdArContent, ".md");
    expect(mdStripped).toBe(mdArContent);

    const txtStripped = compiler.assets.getTranslationOnly(txtArContent, ".txt");
    expect(txtStripped).toBe(txtArContent);
  });

  it("should merge frontmatter and preserve translator's translated body", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const mdPath = join(root, "src/docs/about.md");
    await writeFile(mdPath, `---\ntitle: Welcome\n---\n# Welcome page`);

    await compiler.discover();
    await compiler.flush();

    const mdArPath = compiler.assets.getAssetPath("src/docs/about.md", "ar");

    // Simulate translator editing the file
    const translatedArContent = `---
title: أهلاً بك
---
# صفحة الترحيب`;

    await writeFile(mdArPath, translatedArContent);

    // Now update original markdown file: change title, add author, but keep body
    const mdUpdatedContent = `---
title: Welcome
author: Khalid
---
# Welcome page`;

    await writeFile(mdPath, mdUpdatedContent);

    // Call invalidation to register changes and sync
    await compiler.invalidateFile(mdPath);
    await compiler.flush();

    // Verify updated file preserved translator edits but synced new frontmatter
    const finalArContent = await readFile(mdArPath, "utf-8");

    // Title should still be Arabic (translator preserved)
    expect(finalArContent).toContain("title: أهلاً بك");
    // New key "author: Khalid" should be merged
    expect(finalArContent).toContain("author: Khalid");
    // Translator's body should be preserved exactly
    expect(finalArContent).toContain("# صفحة الترحيب");
    expect(finalArContent).not.toContain("Welcome page updated");
  });

  it("should prune orphaned asset files when a source asset is deleted", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const txtPath = join(root, "src/docs/notice.txt");
    await writeFile(txtPath, "Original notice");

    await compiler.discover();
    await compiler.flush();

    const txtArPath = compiler.assets.getAssetPath("src/docs/notice.txt", "ar");
    const txtFrPath = compiler.assets.getAssetPath("src/docs/notice.txt", "fr");

    expect(existsSync(txtArPath)).toBe(true);
    expect(existsSync(txtFrPath)).toBe(true);

    // Delete the source asset
    await rm(txtPath);

    // Re-discover and flush
    await compiler.discover();
    await compiler.flush();

    // The localized asset files should be pruned (deleted)!
    expect(existsSync(txtArPath)).toBe(false);
    expect(existsSync(txtFrPath)).toBe(false);
  });

  it("should support custom globs, strategies, and output patterns", async (context: LocalContext) => {
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
              strategy: "frontmatter",
              outputPattern: "locales/docs/[locale]/[name].mdx",
            },
            {
              targetPattern: "src/public/*.png",
              strategy: "binary-passthrough",
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

    const mdxArPath = compiler.assets.getAssetPath("src/docs/intro.mdx", "ar");
    expect(mdxArPath).toBe(join(root, "locales/docs/ar/intro.mdx"));
    expect(existsSync(mdxArPath)).toBe(true);
    const mdxContent = await readFile(mdxArPath, "utf-8");
    expect(mdxContent).toContain("title: Intro");
    expect(mdxContent).toContain("Hello MDX");

    const pngArPath = compiler.assets.getAssetPath("src/public/hero.png", "ar");
    expect(pngArPath).toBe(join(root, "locales/assets/ar/hero.png"));
    expect(existsSync(pngArPath)).toBe(true);
    const pngContent = await readFile(pngArPath, "utf-8");
    expect(pngContent).toBe("FAKE_PNG_BINARY_DATA");
  });

  it("should prevent asset collision by injecting [path] when catalogFormat is non-boundary-specific", async (context: LocalContext) => {
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

    const logoPath = compiler.assets.getAssetPath("src/assets/logo.png", "ar");
    // Ensure the catalog path includes the original file path to avoid collision
    expect(logoPath).toBe(join(root, "locales/translations/src/assets/logo.ar.png"));
    expect(existsSync(logoPath)).toBe(true);
    const content = await readFile(logoPath, "utf-8");
    expect(content).toBe("LOGO_DATA");
  });

  it("should support custom strategy functions", async (context: LocalContext) => {
    const root = context.root!;
    await mkdir(join(root, "src/docs"), { recursive: true });
    await writeFile(join(root, "src/docs/custom.txt"), "hello custom strategy");

    const compiler = createTestCompilerWith(
      [
        assetsFacet({
          targets: [
            {
              targetPattern: "src/docs/custom.txt",
              strategy: (srcBuf: Buffer, extBuf: Buffer | null, locale: string) => {
                const text = srcBuf.toString("utf-8");
                return Buffer.from(`[${locale}] ${text.toUpperCase()}`, "utf-8");
              },
              outputPattern: "locales/docs/[locale]/[name].[ext]",
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

    const arPath = compiler.assets.getAssetPath("src/docs/custom.txt", "ar");
    expect(existsSync(arPath)).toBe(true);
    const content = await readFile(arPath, "utf-8");
    expect(content).toBe("[ar] HELLO CUSTOM STRATEGY");
  });

  it("should flag localized assets as outdated when source asset content changes", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const mdPath = join(root, "src/docs/notice.md");
    await writeFile(mdPath, `---\ntitle: Notice\n---\nBody content`);

    // 1. Initial discover & flush to create clean target clone
    await compiler.discover();
    await compiler.flush();

    const mdArPath = compiler.assets.getAssetPath("src/docs/notice.md", "ar");
    expect(existsSync(mdArPath)).toBe(true);

    // Verify initial translated file matches source
    let targetContent = await readFile(mdArPath, "utf-8");
    expect(targetContent).toContain("Body content");
    expect(targetContent).not.toContain("[ZINTL WARNING]");

    // 2. Simulate translator providing a translation
    await writeFile(mdArPath, `---\ntitle: إشعار\n---\nمحتوى الجسم`);

    // Run setup / discover again to harvest the translated content into the Hive
    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    // 3. Modify source asset content (triggering sourceChanged with major rewrite)
    await writeFile(
      mdPath,
      `---\ntitle: Notice\n---\nCompletely rewritten content that is not similar to the original body content.`,
    );

    // Invalidate file to trigger sync
    await compiler.invalidateFile(mdPath);
    await compiler.flush();

    // 4. Verify target file is rewritten with warning comment and new content
    const updatedContent = await readFile(mdArPath, "utf-8");
    expect(updatedContent).toContain("title: Notice");
    expect(updatedContent).toContain(
      "<!-- [ZINTL WARNING] Source content has changed. Please re-translate. -->",
    );
    expect(updatedContent).toContain(
      "Completely rewritten content that is not similar to the original body content.",
    );
  });

  it("should support text asset move recovery from the Hive", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const mdPath = join(root, "src/docs/welcome.md");
    await writeFile(mdPath, `---\ntitle: Welcome\n---\nThis is the welcome page.`);

    // 1. Discover & sync to create the target file
    await compiler.discover();
    await compiler.flush();

    const mdArPath = compiler.assets.getAssetPath("src/docs/welcome.md", "ar");
    expect(existsSync(mdArPath)).toBe(true);

    // 2. Translate it
    await writeFile(mdArPath, `---\ntitle: أهلاً بك\n---\nهذه هي صفحة الترحيب.`);

    // 3. Sync to harvest the translation into the Hive
    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    // 4. Move source file and delete original paths
    const newMdPath = join(root, "src/docs/greeting.md");
    await writeFile(newMdPath, `---\ntitle: Welcome\n---\nThis is the welcome page.`);
    await rm(mdPath);
    await rm(mdArPath);

    // 5. Sync again (the compiler will prune the old target welcome.ar.md, and restore greeting.ar.md from the Hive)
    await compiler.discover();
    await compiler.flush();

    // 6. Verify the old target is gone, and the new target is restored with translation
    expect(existsSync(mdArPath)).toBe(false);
    const newMdArPath = compiler.assets.getAssetPath("src/docs/greeting.md", "ar");
    expect(existsSync(newMdArPath)).toBe(true);
    const content = await readFile(newMdArPath, "utf-8");
    expect(content).toContain("title: أهلاً بك");
    expect(content).toContain("هذه هي صفحة الترحيب.");
  });

  it("should support binary asset move recovery from the Hive", async (context: LocalContext) => {
    const { root } = context as { root: string };

    const pngPath = join(root, "src/docs/logo.png");
    await writeFile(pngPath, Buffer.from("BINARY_LOGO_CONTENT_SOURCE"));

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

    // 1. Discover & sync to create target
    await compiler.discover();
    await compiler.flush();

    const pngArPath = compiler.assets.getAssetPath("src/docs/logo.png", "ar");
    expect(existsSync(pngArPath)).toBe(true);

    // 2. Translate it by writing a different buffer
    await writeFile(pngArPath, Buffer.from("BINARY_LOGO_CONTENT_ARABIC"));

    // 3. Sync to harvest the binary translation
    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    // 4. Move source and delete old paths
    const newPngPath = join(root, "src/docs/brand-logo.png");
    await writeFile(newPngPath, Buffer.from("BINARY_LOGO_CONTENT_SOURCE"));
    await rm(pngPath);
    await rm(pngArPath);

    // 5. Sync again
    await compiler.discover();
    await compiler.flush();

    // 6. Verify restoration
    expect(existsSync(pngArPath)).toBe(false);
    const newPngArPath = compiler.assets.getAssetPath("src/docs/brand-logo.png", "ar");
    expect(existsSync(newPngArPath)).toBe(true);
    const content = await readFile(newPngArPath);
    expect(content.toString("utf-8")).toBe("BINARY_LOGO_CONTENT_ARABIC");
  });

  it("should support fuzzy matching and waterfall review flagging on same-path modification", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const mdPath = join(root, "src/docs/waterfall.md");
    await writeFile(
      mdPath,
      `---\ntitle: Waterfall Page\n---\nThis is the body content of the waterfall page.`,
    );

    // 1. Discover & sync
    await compiler.discover();
    await compiler.flush();

    const mdArPath = compiler.assets.getAssetPath("src/docs/waterfall.md", "ar");
    expect(existsSync(mdArPath)).toBe(true);

    // 2. Translate
    await writeFile(mdArPath, `---\ntitle: صفحة الشلال\n---\nهذا هو محتوى جسم صفحة الشلال.`);

    // 3. Harvest
    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    // 4. Minor modification (Fuzzy match)
    await writeFile(
      mdPath,
      `---\ntitle: Waterfall Page\n---\nThis is the body content of the waterfall page!`,
    );

    await compiler.invalidateFile(mdPath);
    await compiler.flush();

    // Verify translation is preserved but with warning header
    let content = await readFile(mdArPath, "utf-8");
    expect(content).toContain("title: صفحة الشلال"); // Frontmatter translated value merged & preserved
    expect(content).toContain(
      "<!-- [ZINTL WARNING] Source content has changed slightly. Please review translation. -->",
    );
    expect(content).toContain("هذا هو محتوى جسم صفحة الشلال.");

    // 5. Major modification (No match)
    await writeFile(
      mdPath,
      `---\ntitle: Waterfall Page\n---\nCompletely different rewrite of this document body content.`,
    );

    await compiler.invalidateFile(mdPath);
    await compiler.flush();

    // Verify target is overwritten with source content and standard warning comment
    content = await readFile(mdArPath, "utf-8");
    expect(content).toContain("title: Waterfall Page");
    expect(content).toContain(
      "<!-- [ZINTL WARNING] Source content has changed. Please re-translate. -->",
    );
    expect(content).toContain("Completely different rewrite of this document body content.");
  });

  it("should support fuzzy matching and recovery on path moves", async (context: LocalContext) => {
    const { root, compiler } = context as { root: string; compiler: ZintlCompiler };

    const mdPath = join(root, "src/docs/fuzzy_move.md");
    await writeFile(
      mdPath,
      `---\ntitle: Move Page\n---\nThis is a page that will be moved and modified slightly.`,
    );

    // 1. Discover & sync
    await compiler.discover();
    await compiler.flush();

    const mdArPath = compiler.assets.getAssetPath("src/docs/fuzzy_move.md", "ar");
    expect(existsSync(mdArPath)).toBe(true);

    // 2. Translate
    await writeFile(mdArPath, `---\ntitle: صفحة النقل\n---\nهذه صفحة سيتم نقلها وتعديلها قليلاً.`);

    // 3. Harvest
    await compiler.setup();
    await compiler.discover();
    await compiler.flush();

    // 4. Move and slightly modify source
    const newMdPath = join(root, "src/docs/fuzzy_moved.md");
    await writeFile(
      newMdPath,
      `---\ntitle: Move Page\n---\nThis is a page that will be moved and modified slightly!`,
    );
    await rm(mdPath);
    await rm(mdArPath);

    // 5. Sync again
    await compiler.discover();
    await compiler.flush();

    // 6. Verify restoration with warning
    expect(existsSync(mdArPath)).toBe(false);
    const newMdArPath = compiler.assets.getAssetPath("src/docs/fuzzy_moved.md", "ar");
    expect(existsSync(newMdArPath)).toBe(true);

    const content = await readFile(newMdArPath, "utf-8");
    expect(content).toContain("title: صفحة النقل"); // Preserved translated title
    expect(content).toContain(
      "<!-- [ZINTL WARNING] Source content has changed slightly. Please review translation. -->",
    );
    expect(content).toContain("هذه صفحة سيتم نقلها وتعديلها قليلاً.");
  });
});
