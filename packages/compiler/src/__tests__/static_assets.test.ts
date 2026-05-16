import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createTestDir, type TestContext } from "./helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("Zintl Compiler - Static Content Files (Markdown & Text)", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("zintl-static-assets-test-");
    context.root = root;
    await mkdir(join(root, "src/docs"), { recursive: true });
    context.compiler = new ZintlCompiler(
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

    // Now update original markdown file: change title, add author, and change body
    const mdUpdatedContent = `---
title: Welcome
author: Khalid
---
# Welcome page updated`;

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
});
