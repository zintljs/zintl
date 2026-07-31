import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";
import { sha1 } from "@zintljs/compiler";
import zintl from "../vite.js";
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
        import { zintl } from "zintl";
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
        import { zintl } from "zintl";
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
        import { zintl } from "zintl";
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
        import { zintl } from "zintl";
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

  it("Scenario 5: Zero-Disk Asset Build Optimization (Zero-Disk Reference Mode)", async () => {
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
      const textHash = sha1(sourceText);

      const sourceImageBuffer = Buffer.from([1, 2, 3, 4]);
      const translatedImageBuffer = Buffer.from([5, 6, 7, 8]);
      const imageHash = sha1(sourceImageBuffer);

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
        "src/hero.png": sourceImageBuffer.toString("binary"),
        "src/main.ts": `
          import { zintl } from "zintl";
          import aboutText from "./about.txt?raw";
          import heroImg from "./hero.png";
          zintl("ar");
          console.log(aboutText, heroImg);
        `,
        "node_modules/.zintl/hive.json": JSON.stringify({
          ar: {
            [`@zintl/asset-hash:${textHash}`]: translatedText,
            [`@zintl/asset-hash:${imageHash}`]: translatedImageBuffer.toString("base64"),
          },
          en: {
            [`@zintl/asset-hash:${textHash}`]: sourceText,
            [`@zintl/asset-hash:${imageHash}`]: sourceImageBuffer.toString("base64"),
          },
        }),
      };

      for (const [path, content] of Object.entries(files)) {
        await zeroDiskCtx.setupFile(path, content);
      }

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

      const fs = await import("node:fs");
      const pathModule = await import("node:path");

      const physicalTextAsset = pathModule.join(zeroDiskCtx.root, "src/locales/src/about.ar.txt");
      const physicalBinaryAsset = pathModule.join(zeroDiskCtx.root, "src/locales/src/hero.ar.png");

      expect(fs.existsSync(physicalTextAsset)).toBe(false);
      expect(fs.existsSync(physicalBinaryAsset)).toBe(false);

      const distAssetsDir = pathModule.join(zeroDiskCtx.root, "dist/assets");
      expect(fs.existsSync(distAssetsDir)).toBe(true);

      const arAssetsDir = pathModule.join(distAssetsDir, "ar");
      expect(fs.existsSync(arAssetsDir)).toBe(true);

      const arFiles = fs.readdirSync(arAssetsDir);
      const arIndexJs = arFiles.find((f) => f.startsWith("index") && f.endsWith(".js"));
      expect(arIndexJs).toBeDefined();

      const arIndexContent = fs.readFileSync(pathModule.join(arAssetsDir, arIndexJs!), "utf-8");
      expect(arIndexContent).toContain(translatedText);

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
