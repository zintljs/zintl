import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

/**
 * The fence for ledger L-022, exercised through a real `zintljs/rsbuild` build.
 *
 * Before the fence existed, this exact combination — `multiplex: true` on a
 * bundler with no HTML fan-out — crashed inside `html-rspack-plugin`'s child
 * compilation with an error naming a loader chain, not Zintl:
 * `loadIncludeHook` claimed the HTML template, unplugin's `load` rule retyped
 * it as `javascript/auto`, and the build died parsing `<!doctype html>` as JS.
 *
 * This fixture proves the opposite now holds: the build rejects fast, before
 * any module resolution happens, with a clear `[Zintl] Multiplex is not
 * supported...` error. It is deliberately not a sibling of
 * `multiplex-assets.ts`'s Rsbuild half-that-never-shipped — that file's intent
 * is proving real fan-out works once L-022 is *actually* fixed, a different
 * purpose from proving the fence throws. Nothing here needs to be reachable:
 * the build must fail before extraction, asset emission, or anything else
 * this app's content might otherwise exercise.
 */
const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar"],
  outputDir: "./src/locales",
  // Explicit, so the fence fires by declaration rather than by entry-file
  // auto-detection quietly picking a different answer on a different host.
  multiplex: true,
};

const SHARED_FILES: Record<string, string> = {
  /**
   * Authored by hand, not generated. `fixtureSource` only ever synthesizes a
   * `vite.config.ts` — this fixture needs the Rsbuild config the harness's
   * `RsbuildDriver` actually reads (`loadConfig({ cwd })`), matching
   * `examples/rsbuild-spa/rsbuild.config.mjs`'s shape.
   */
  "rsbuild.config.mjs": [
    `import { defineConfig } from "@rsbuild/core";`,
    `import zintl from "zintljs/rsbuild";`,
    ``,
    `export default defineConfig({`,
    `  plugins: [`,
    `    ...zintl(${JSON.stringify(zintlOptions, null, 6).replace(/\n/g, "\n    ")}),`,
    `  ],`,
    `  source: { entry: { index: "./src/main.ts" } },`,
    `  html: { template: "./index.html" },`,
    `});`,
    ``,
  ].join("\n"),

  "index.html": [
    `<!doctype html>`,
    `<html lang="en">`,
    `  <head><meta charset="UTF-8" /><title>Multiplex fence</title></head>`,
    `  <body>`,
    `    <div id="app"></div>`,
    `  </body>`,
    `</html>`,
    ``,
  ].join("\n"),

  "src/main.ts": [
    `import { zintl } from "zintljs/macro";`,
    ``,
    `async function render() {`,
    `  await zintl("*");`,
    `  document.querySelector<HTMLDivElement>("#app")!.innerHTML = "<h1>Get started</h1>";`,
    `}`,
    ``,
    `render();`,
    ``,
  ].join("\n"),
};

const adapter = {
  headingSelector: "h1",
  initialHeadingText: "Get started",
  headingFile: "src/main.ts",
  navigateHome: async (lab: { page: { goto: (u: string) => Promise<unknown> }; url: string }) => {
    await lab.page.goto(`${lab.url}/`);
  },
};

export const multiplexRsbuildFence: ProjectManifest = {
  name: "multiplex-rsbuild-fence",
  source: fixtureSource({ id: "multiplex-rsbuild-fence", zintlOptions, files: SHARED_FILES }),
  driver: "rsbuild",
  zintlOptions,
  /**
   * Deliberately **not** `"build"`. That capability means "a normal
   * production build succeeds and is snapshotted" (`build.contract.spec.ts`,
   * `facet-composition.contract.spec.ts`) — this project's build is supposed
   * to fail, so claiming it would fail those contracts rather than skip them.
   */
  capabilities: ["multiplex-fenced"],
  adapter,
};
