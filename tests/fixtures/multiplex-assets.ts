import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

/**
 * Asset **emission** under multiplex, on both hosts — the reproduction ledger
 * L-005 has been waiting for.
 *
 * L-005 is the one leak from proposal 026 that was never reproduced, and the
 * reason was precise rather than an excuse: both `emitFile` call sites sit
 * behind branches only a multiplexed build with `virtualAssets` reaches, and
 * 026 §7 excluded the multiplex path from that spike.
 *
 * The claim to falsify: `emitFile` returns a **reference id** on Rollup, which
 * `import.meta.ROLLUP_FILE_URL_<id>` later resolves to the final hashed URL.
 * Rspack's is `compilation.emitAsset(name, source)` — fire and forget,
 * returning `undefined` — so there is no handle to interpolate, and the strategy
 * has no counterpart rather than a different spelling.
 *
 * **Why an SVG, imported without `?raw`.** Both details are load-bearing.
 * `?raw` returns a JavaScript string literal and never calls `emitFile`, which
 * is exactly why every asset path exercised so far survived on Rspack. And the
 * extension decides the strategy: `.txt` and `.md` are passthrough *content*,
 * while anything else is `binary-passthrough` — the one branch that asks the
 * host to emit a file and hand back a reference id.
 *
 * Both manifests claim `build` only. These exist to make a build-time defect
 * reproducible, not to assert anything in a browser.
 */
const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar"],
  outputDir: "./src/locales",
  assetsTarget: ["svg"],
  // The two gates on the `emitFile` branches. Set explicitly rather than left to
  // the entry scan, so the fixture reaches them by declaration.
  multiplex: true,
  virtualAssets: true,
  /**
   * Off, because this fixture is about **emission** and its app text is beside
   * the point. With it on, the build fails on a missing `ar` translation for the
   * heading before it ever reaches an `emitFile` call — a correct error about
   * the wrong thing, hiding the one being reproduced.
   */
  verifyIntegrity: false,
};

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><title>left</title></svg>\n`;
const ARABIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><title>يمين</title></svg>\n`;

const SHARED_FILES: Record<string, string> = {
  "index.html": [
    `<!doctype html>`,
    `<html lang="en">`,
    `  <head><meta charset="UTF-8" /><title>Multiplex assets</title></head>`,
    `  <body>`,
    `    <div id="app"></div>`,
    `    <script type="module" src="/src/main.ts"></script>`,
    `  </body>`,
    `</html>`,
    ``,
  ].join("\n"),

  "src/logo.svg": SOURCE_SVG,
  "src/locales/src/logo.ar.svg": ARABIC_SVG,

  "src/main.ts": [
    `import { zintl } from "zintljs/macro";`,
    // No `?raw`: this asks the host for a URL, which is the contract L-005 says
    // Rspack does not have.
    `import logoUrl from "./logo.svg";`,
    ``,
    `async function render() {`,
    `  await zintl("en");`,
    `  document.querySelector<HTMLDivElement>("#app")!.innerHTML =`,
    '    `<h1 id="asset-url">Get started</h1><a id="about" href="${aboutUrl}">about</a>`;',
    `}`,
    ``,
    `render();`,
    ``,
  ].join("\n"),
};

const adapter = {
  headingSelector: "#asset-url",
  initialHeadingText: "Get started",
  headingFile: "src/main.ts",
  navigateHome: async (lab: { page: { goto: (u: string) => Promise<unknown> }; url: string }) => {
    await lab.page.goto(`${lab.url}/`);
  },
};

/** The control: the same project on the supported host. */
export const multiplexAssets: ProjectManifest = {
  name: "multiplex-assets",
  source: fixtureSource({ id: "multiplex-assets", zintlOptions, files: SHARED_FILES }),
  zintlOptions,
  capabilities: ["build"],
  adapter,
};

/**
 * The Rsbuild half is **deliberately not here**, and that is the L-005 finding.
 *
 * It was written, run, and removed. A multiplexed Rsbuild build cannot complete
 * at all: `loadIncludeHook` claims `.html` under multiplex — the sole mode where
 * `loadHook` returns HTML — and on Rspack merely claiming a module retypes it as
 * JavaScript, so the template dies in the JS parser before any `emitFile` call
 * is reached. That is ledger L-006 recurring in the exact branch L-006's own
 * note flagged as the risky one, and it is recorded as L-022.
 *
 * So L-005 stays unreproduced, but for a named blocker rather than for want of
 * trying — and both it and L-022 sit in the MPA/HTML fan-out territory that 026
 * §7 and 027 §6 explicitly exclude. Add the second manifest here when L-022 is
 * fixed; the control above is what makes that cheap.
 */
