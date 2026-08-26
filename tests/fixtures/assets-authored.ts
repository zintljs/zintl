import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

/**
 * Both halves of proposal 035, on targets nothing hardcodes.
 *
 * `assets-basic` covers the case Zintl always had: a `.txt` imported with
 * `?raw`, arriving as text. This fixture covers what 035 added, and does it on
 * extensions that are **not** in `DEFAULT_ASSET_TARGETS` — which is the point of
 * choosing `.rst` over another `.txt`.
 *
 * - **`.rst`, imported with `?raw`.** A configured target that no code path
 *   names. The plugin used to ask the facet whether it owned a file while
 *   *resolving* an import and then test for `.md`/`.txt` by hand while
 *   *loading* the module, so a target like this one was recognised on the way in
 *   and unknown on the way out (034 §1.3). Nothing measured that, because every
 *   asset in the repository was a `.txt`.
 * - **`.png`, imported plainly.** Delivered by reference: the bundler emits the
 *   per-locale artifact and hands back a URL. Before 035 this path did not
 *   exist at all — binary assets were skipped by `getAssetTranslations` and
 *   resolved by nothing, so targeting one produced a file on disk that no module
 *   ever read.
 *
 * Both artifacts are **authored**, which is the model rather than a convenience:
 * the compiler scaffolds each slot empty and a person fills it. Nothing here is
 * derived from the source, and the Arabic image is a different colour from the
 * English one precisely so that "it served the source file" cannot pass.
 */
const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar"],
  outputDir: "./src/locales",
  assetsTarget: ["rst", "png"],
};

const SOURCE_TEXT = "Structured text, in English.";
const ARABIC_TEXT = "نص منسق، بالعربية.";

/**
 * Two 1×1 PNGs, red for `en` and blue for `ar`.
 *
 * Real PNG bytes rather than a text file with an image extension: the whole
 * claim is that a file Zintl can never read as text still reaches the browser
 * intact, and a fixture that cheats on that measures nothing.
 */
const SOURCE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4o6YGAAMKASng8MlTAAAAAElFTkSuQmCC";
const ARABIC_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQTX4NAAIkAXSaGkHUAAAAAElFTkSuQmCC";

export const assetsAuthored: ProjectManifest = {
  name: "assets-authored",
  source: fixtureSource({
    id: "assets-authored",
    zintlOptions,
    files: {
      "index.html": [
        `<!doctype html>`,
        `<html lang="en">`,
        `  <head><meta charset="UTF-8" /><title>Authored assets fixture</title></head>`,
        `  <body>`,
        `    <div id="app"></div>`,
        `    <script type="module" src="/src/main.ts"></script>`,
        `  </body>`,
        `</html>`,
        ``,
      ].join("\n"),

      "src/about.rst": SOURCE_TEXT,
      "src/hero.png": { base64: SOURCE_PNG },

      // Authored per locale, under `outputDir`, following the default
      // `<path>.<locale><ext>` pattern. Neither is derived from its source.
      "src/locales/src/about.ar.rst": ARABIC_TEXT,
      "src/locales/src/hero.ar.png": { base64: ARABIC_PNG },

      "src/main.ts": [
        `import { zintl } from "zintljs/macro";`,
        `import aboutText from "./about.rst?raw";`,
        `import heroUrl from "./hero.png";`,
        ``,
        `async function render() {`,
        `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `  await zintl(lang);`,
        `  document.querySelector<HTMLDivElement>("#app")!.innerHTML =`,
        '    `<h1 id="asset-text">${aboutText}</h1>` +',
        // No `alt`: it would be an extracted string, and this fixture ships no
        // catalogs. A missing translation is a build error here, so an unrelated
        // one would fail `asset-integrity` for a reason it is not about.
        '    `<img id="asset-image" src="${heroUrl}" />`;',
        `}`,
        ``,
        `render();`,
        ``,
      ].join("\n"),
    },
  }),
  zintlOptions,
  /**
   * **Not `asset-hmr`.** `assets-basic` already measures the Vite dev loop, and
   * a second Vite fixture asserting the same cascade would cost a pooled dev
   * server to restate a claim rather than to test one.
   *
   * **Not `build`.** That capability enrols a project in the full production
   * snapshot contract, and this fixture's build output is already exercised —
   * more precisely — by `asset-integrity`, which reads the error rather than
   * the bytes.
   */
  capabilities: ["spa", "assets", "asset-reference", "asset-integrity"],
  adapter: {
    headingSelector: "#asset-text",
    initialHeadingText: SOURCE_TEXT,
    headingFile: "src/about.rst",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    assetSelector: "#asset-text",
    assetText: { en: SOURCE_TEXT, ar: ARABIC_TEXT },
    assetFile: "src/about.rst",
    referenceAsset: {
      selector: "#asset-image",
      file: "src/hero.png",
      bytes: { en: SOURCE_PNG, ar: ARABIC_PNG },
    },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/?lang=${locale}`);
    },
  },
};
