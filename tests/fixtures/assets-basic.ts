import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

/**
 * Localized static assets, with no example application behind it.
 *
 * No example in `examples/` exercises `assetsTarget`, so this behaviour was
 * only ever covered by unit tests against the compiler. This fixture runs it
 * end to end: a real dev server, a real browser, a real `?raw` import.
 *
 * Shape mirrors the proven unit scenario in
 * `packages/zintl/src/__tests__/asset_scenarios.test.ts` — a `.txt` asset with
 * a sibling localized copy under `outputDir`, following the default
 * `<path>.<locale><ext>` output pattern.
 */
const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar"],
  outputDir: "./src/locales",
  assetsTarget: ["txt"],
};

const SOURCE_TEXT = "Hello World!";
const ARABIC_TEXT = "مرحباً بالعالم!";

export const assetsBasic: ProjectManifest = {
  name: "assets-basic",
  source: fixtureSource({
    id: "assets-basic",
    zintlOptions,
    files: {
      "index.html": [
        `<!doctype html>`,
        `<html lang="en">`,
        `  <head><meta charset="UTF-8" /><title>Assets fixture</title></head>`,
        `  <body>`,
        `    <div id="app"></div>`,
        `    <script type="module" src="/src/main.ts"></script>`,
        `  </body>`,
        `</html>`,
        ``,
      ].join("\n"),

      "src/about.txt": SOURCE_TEXT,

      // The localized copy, following the default `<path>.<locale><ext>`
      // pattern relative to outputDir.
      "src/locales/src/about.ar.txt": ARABIC_TEXT,

      "src/main.ts": [
        `import { zintl } from "zintljs/macro";`,
        `import aboutText from "./about.txt?raw";`,
        ``,
        `async function render() {`,
        `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `  await zintl(lang);`,
        `  document.querySelector<HTMLDivElement>("#app")!.innerHTML = ` +
          '`<h1 id="asset-text">${aboutText}</h1>`;',
        `}`,
        ``,
        `render();`,
        ``,
      ].join("\n"),
    },
  }),
  zintlOptions,
  capabilities: ["spa", "assets"],
  adapter: {
    headingSelector: "#asset-text",
    initialHeadingText: SOURCE_TEXT,
    headingFile: "src/about.txt",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    // This fixture's heading *is* its asset, which is why the contract could
    // get away with conflating them. Stated separately anyway — the contract
    // now asks for the asset, and an app where the two differ must be able to
    // say so.
    assetSelector: "#asset-text",
    assetText: { en: SOURCE_TEXT, ar: ARABIC_TEXT },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/?lang=${locale}`);
    },
  },
};
