import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
import zintl from "../vite.js";
import { encodeAssetId, decodeAssetId } from "../constants.js";
/**
 * High-Fidelity Asset Scenarios Test Suite
 *
 * This suite explores the deep architectural behavior of static asset support (.md and .txt)
 * under various anchor states, nested scopes, non-anchors, and dynamic (lazy) imports.
 */
describe("Scenario: Asset Support under Anchor Hierarchies", () => {
  let ctx: Awaited<ReturnType<typeof createZintlContext>>;

  beforeEach(async () => {
    ctx = await createZintlContext({
      locales: ["en", "ar", "es"],
      outputDir: "./src/locales",
      catalogFormat: "i18n.json",
      multiplex: true,
      logLevel: "silent",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("Scenario 1: Asset imported directly under a Static Anchor (Normal Anchor)", async () => {
    const files = {
      "index.html": `
        <!DOCTYPE html>
        <html>
        <body>
          <script type="module" src="/src/main.ts"></script>
        </body>
        </html>
      `,
      "src/about.txt": `Hello World!`,
      "src/main.ts": `
        import { zintl } from "zintljs";
        import aboutText from "./about.txt?raw";
        zintl("ar");
        console.log(aboutText);
      `,
      "src/locales/src/about.ar.txt": `مرحباً بالعالم!`,
    };

    // 1. Write files
    for (const [path, content] of Object.entries(files)) {
      await ctx.setupFile(path, content);
    }

    // 2. Run real production build
    const buildResults = await ctx.build();

    // 3. Verify localized content was compiled
    let foundTranslated = false;
    for (const [file, code] of Object.entries(buildResults)) {
      if (file.endsWith(".js") && file.includes("ar/index")) {
        if (code.includes("مرحباً بالعالم!")) {
          foundTranslated = true;
        }
      }
    }
    expect(foundTranslated).toBe(true);
  });

  it("Scenario 2: Asset imported under a Non-Anchor with Multiplexing Propagation", async () => {
    const files = {
      "index.html": `
        <!DOCTYPE html>
        <html>
        <body>
          <script type="module" src="/src/main.ts"></script>
        </body>
        </html>
      `,
      "src/about.txt": `Help Doc Content`,
      "src/ui.ts": `
        import doc from "./about.txt?raw";
        export const getDoc = () => doc;
      `,
      "src/main.ts": `
        import { zintl } from "zintljs";
        import { getDoc } from "./ui";
        zintl("ar");
        console.log(getDoc());
      `,
      "src/locales/src/about.ar.txt": `محتوى وثيقة المساعدة`,
    };

    for (const [path, content] of Object.entries(files)) {
      await ctx.setupFile(path, content);
    }

    const buildResults = await ctx.build();

    let foundTranslated = false;
    for (const [file, code] of Object.entries(buildResults)) {
      if (file.endsWith(".js") && file.includes("ar/index")) {
        if (code.includes("محتوى وثيقة المساعدة")) {
          foundTranslated = true;
        }
      }
    }
    expect(foundTranslated).toBe(true);
  });

  it("Scenario 3: Asset loaded dynamically inside a Lazy Chunk", async () => {
    const files = {
      "index.html": `
        <!DOCTYPE html>
        <html>
        <body>
          <script type="module" src="/src/main.ts"></script>
        </body>
        </html>
      `,
      "src/about.txt": `Lazy Content`,
      "src/lazy.ts": `
        import lazyText from "./about.txt?raw";
        export const printText = () => lazyText;
      `,
      "src/main.ts": `
        import { zintl } from "zintljs";
        async function run() {
          zintl("ar");
          const { printText } = await import("./lazy");
          console.log(printText());
        }
        run();
      `,
      "src/locales/src/about.ar.txt": `محتوى كسول`,
    };

    for (const [path, content] of Object.entries(files)) {
      await ctx.setupFile(path, content);
    }

    const buildResults = await ctx.build();

    let foundTranslated = false;
    for (const [file, code] of Object.entries(buildResults)) {
      if (file.endsWith(".js")) {
        if (code.includes("محتوى كسول")) {
          foundTranslated = true;
        }
      }
    }
    expect(foundTranslated).toBe(true);
  });

  it("Scenario 4: Non-multiplexed dynamic proxy asset loading", async () => {
    const files = {
      "index.html": `
        <!DOCTYPE html>
        <html>
        <body>
          <script type="module" src="/src/main.ts"></script>
        </body>
        </html>
      `,
      "src/about.txt": `Source Content`,
      "src/main.ts": `
        import { zintl } from "zintljs";
        import aboutText from "./about.txt?raw";
        zintl("ar");
        console.log(aboutText);
      `,
      "src/locales/src/about.ar.txt": `محتوى المصدر المترجم`,
    };

    const nonMultiplexCtx = await createZintlContext({
      locales: ["en", "ar", "es"],
      outputDir: "./src/locales",
      catalogFormat: "i18n.json",
      multiplex: false,
      logLevel: "silent",
    });

    try {
      for (const [path, content] of Object.entries(files)) {
        await nonMultiplexCtx.setupFile(path, content);
      }

      const buildResults = await nonMultiplexCtx.build();

      let foundProxyModule = false;
      let foundCatalogChunk = false;
      for (const [file, code] of Object.entries(buildResults)) {
        if (file.endsWith(".js")) {
          if (
            code.includes("Symbol.toPrimitive") &&
            code.includes("getLocale") &&
            code.includes("_t") &&
            code.includes("Source Content")
          ) {
            foundProxyModule = true;
          }
          if (code.includes("محتوى المصدر المترجم")) {
            foundCatalogChunk = true;
          }
        }
      }
      expect(foundProxyModule).toBe(true);
      expect(foundCatalogChunk).toBe(true);
    } finally {
      await nonMultiplexCtx.cleanup();
    }
  });

  /**
   * **A binary artifact is authored, and reaches the browser as a URL.**
   *
   * This scenario used to be called "Zero-Disk": `virtualAssets` meant *do not
   * write the artifact*, and the localized bytes were reconstructed from base64
   * backups the hive kept of previous localized content. Both halves are gone.
   * Artifacts are always written, because an author needs a file to fill, and
   * the hive stores identity rather than content (035 §5.1, §5.2) — so
   * `virtualAssets` now chooses the *delivery route* and nothing else.
   *
   * What it covers is the case nothing else could: a `.png` is imported plainly,
   * so it is delivered by reference, and the URL the build emits must point at
   * the bytes a person authored for Arabic rather than at the English source.
   * Before this change that path did not exist — binary assets were excluded
   * from catalogs and resolved by nothing.
   */
  it("Scenario 5: an authored binary artifact is emitted by reference", async () => {
    const zeroDiskCtx = await createZintlContext({
      locales: ["en", "ar"],
      outputDir: "./src/locales",
      catalogFormat: "i18n.json",
      multiplex: true,
      virtualAssets: true,
      assetsTarget: ["md", "txt", "png"],
      logLevel: "silent",
    });

    try {
      const sourceText = "Hello World Text!";
      const translatedText = "مرحباً بالعالم نصاً!";

      const sourceImageBuffer = Buffer.from([1, 2, 3, 4]);
      const translatedImageBuffer = Buffer.from([5, 6, 7, 8]);

      const files = {
        "index.html": `
          <!DOCTYPE html>
          <html>
          <body>
            <script type="module" src="/src/main.ts"></script>
          </body>
          </html>
        `,
        "src/about.txt": sourceText,
        "src/main.ts": `
          import { zintl } from "zintljs";
          import aboutText from "./about.txt?raw";
          import heroImg from "./hero.png";
          zintl("ar");
          console.log(aboutText, heroImg);
        `,
        // Authored by a person, for Arabic. Nothing derives these from above.
        "src/locales/src/about.ar.txt": translatedText,
      };

      for (const [path, content] of Object.entries(files)) {
        await zeroDiskCtx.setupFile(path, content);
      }

      const fs = await import("node:fs");
      const pathModule = await import("node:path");

      fs.writeFileSync(pathModule.join(zeroDiskCtx.root, "src/hero.png"), sourceImageBuffer);
      fs.mkdirSync(pathModule.join(zeroDiskCtx.root, "src/locales/src"), { recursive: true });
      fs.writeFileSync(
        pathModule.join(zeroDiskCtx.root, "src/locales/src/hero.ar.png"),
        translatedImageBuffer,
      );

      const { build: viteBuild } = await import("vite");

      await viteBuild({
        root: zeroDiskCtx.root,
        logLevel: "silent",
        plugins: [
          zintl({
            sourceLocale: "en",
            locales: ["en", "ar"],
            prune: false,
            verifyIntegrity: false,
            virtualAssets: true,
            multiplex: true,
            assetsTarget: ["md", "txt", "png"],
            outputDir: "./src/locales",
            catalogFormat: "i18n.json",
          }),
        ],
        build: {
          write: true,
          outDir: "dist",
          minify: false,
          rollupOptions: {
            output: {
              entryFileNames: "assets/[name].js",
              chunkFileNames: "assets/[name].js",
              assetFileNames: "assets/[name]-[hash].[ext]",
            },
          },
        },
      });

      // Artifacts live on disk under `outputDir`, `virtualAssets` or not: the
      // file is where the author works, and a scaffold nobody can see is a
      // scaffold nobody can fill.
      const physicalTextAsset = pathModule.join(zeroDiskCtx.root, "src/locales/src/about.ar.txt");
      const physicalBinaryAsset = pathModule.join(zeroDiskCtx.root, "src/locales/src/hero.ar.png");
      expect(fs.existsSync(physicalTextAsset)).toBe(true);
      expect(fs.existsSync(physicalBinaryAsset)).toBe(true);

      const distAssetsDir = pathModule.join(zeroDiskCtx.root, "dist/assets");
      const arAssetsDir = pathModule.join(distAssetsDir, "ar");
      expect(fs.existsSync(arAssetsDir)).toBe(true);

      const arFiles = fs.readdirSync(arAssetsDir);
      const arIndexJs = arFiles.find((f) => f.startsWith("index") && f.endsWith(".js"));
      expect(arIndexJs).toBeDefined();

      // `?raw` asked for the contents, so the Arabic text is inlined.
      const arIndexContent = fs.readFileSync(pathModule.join(arAssetsDir, arIndexJs!), "utf-8");
      expect(arIndexContent).toContain(translatedText);

      // The plain import asked for a URL, and the bytes behind it are the ones
      // authored for Arabic — not the English source, which is the whole point.
      const distFiles = fs.readdirSync(distAssetsDir);
      const emittedImageFile = distFiles.find((f) => f.startsWith("hero") && f.endsWith(".png"));
      expect(emittedImageFile).toBeDefined();

      const emittedImageBuffer = fs.readFileSync(pathModule.join(distAssetsDir, emittedImageFile!));
      expect(emittedImageBuffer.equals(translatedImageBuffer)).toBe(true);
    } finally {
      await zeroDiskCtx.cleanup();
    }
  });
});

/**
 * The id these mint becomes the emitted chunk's *name*, which is why it is
 * encoded relative to the root: an absolute path published the build machine's
 * filesystem to anyone with a base64 decoder.
 */
describe("asset module ids", () => {
  const RAW = "\0virtual:zintl/rawasset";
  const ROOT = "/Users/someone/projects/site";

  it("round-trips a path and its query", () => {
    const original = `${ROOT}/src/content/page.md?raw`;
    const encoded = encodeAssetId(RAW, ROOT, original);
    expect(decodeAssetId(RAW, ROOT, encoded)).toBe(original);
  });

  it("names the chunk without naming the machine", () => {
    const encoded = encodeAssetId(RAW, ROOT, `${ROOT}/src/content/page.md?raw`);
    const decodedName = Buffer.from(encoded.slice(RAW.length + 1), "base64url").toString("utf8");

    expect(decodedName).toBe("src/content/page.md?raw");
    expect(decodedName).not.toContain(ROOT);
    // The extension must stay out of the id itself, or a host types the module
    // by it and base64s our JavaScript into a data: URI (L-009).
    expect(encoded.endsWith(".md")).toBe(false);
  });

  it("round-trips a file outside the root", () => {
    const original = "/Users/someone/projects/shared/notice.txt?raw";
    const encoded = encodeAssetId(RAW, ROOT, original);
    expect(decodeAssetId(RAW, ROOT, encoded)).toBe(original);
  });

  it("round-trips an id with no query", () => {
    const original = `${ROOT}/src/hero.webp`;
    expect(decodeAssetId(RAW, ROOT, encodeAssetId(RAW, ROOT, original))).toBe(original);
  });
});
