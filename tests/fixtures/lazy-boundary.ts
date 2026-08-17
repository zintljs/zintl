import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

/**
 * A colony behind a dynamic import, hot-updated.
 *
 * **The hole this fills is host-shaped, and it is on the side nobody expected.**
 * Lazy `$L` boundaries are exercised by two real applications in the contract
 * suite — `rsbuild-vanilla-spa` and `rsbuild-vue-spa` — and both of them are on
 * Rspack. The two Vite applications with lazy routes, `examples/vanilla-spa` and
 * `examples/vue-spa`, are absent from the manifest. So colony behaviour on
 * **Rollup**, the original and primary host, was proven only by unit tests
 * against the compiler, while the newer host had real-browser coverage.
 *
 * A fixture rather than a promoted example, deliberately: the question is "does
 * a lazily-imported boundary hot-update", not "does this application work", and
 * `tests/manifests/index.ts` costs roughly (projects × matching contracts).
 *
 * The heading lives in the **lazily imported** module, which is the whole
 * point. `hmr` edits `headingFile`, so pointing it at the colony makes the
 * existing contract exercise the path that had none — a shared or lazy
 * boundary does not match a direct entry chunk, and reaching its manager needs
 * the boundary→path→reachability traversal ZHMR §2.2③ describes.
 */
const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

const HEADING = "Lazy colony";

export const lazyBoundary: ProjectManifest = {
  name: "lazy-boundary",
  source: fixtureSource({
    id: "lazy-boundary",
    zintlOptions,
    files: {
      "index.html": [
        `<!doctype html>`,
        `<html lang="en">`,
        `  <head><meta charset="UTF-8" /><title>Lazy boundary fixture</title></head>`,
        `  <body>`,
        `    <div id="app"></div>`,
        `    <script type="module" src="/src/main.ts"></script>`,
        `  </body>`,
        `</html>`,
        ``,
      ].join("\n"),

      "src/main.ts": [
        `import { zintl } from "zintljs/macro";`,
        ``,
        `async function render() {`,
        `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `  await zintl(lang);`,
        ``,
        `  document.querySelector<HTMLDivElement>("#app")!.innerHTML =`,
        '    `<div id="shell"><p id="shell-text">Application shell</p><div id="page"></div></div>`;',
        ``,
        `  // The colony. Everything reachable from here is its own boundary, and`,
        `  // it is emitted as a separate chunk rather than folded into the entry.`,
        `  const { renderPage } = await import("./pages/about.ts");`,
        `  renderPage(document.querySelector<HTMLDivElement>("#page")!);`,
        `}`,
        ``,
        `void render();`,
        ``,
      ].join("\n"),

      "src/pages/about.ts": [
        `export function renderPage(host: HTMLDivElement) {`,
        "  host.innerHTML = `<h1>" + HEADING + "</h1><p>Loaded on demand</p>`;",
        `}`,
        ``,
      ].join("\n"),

      "package.json": JSON.stringify(
        { name: "lazy-boundary", private: true, type: "module" },
        null,
        2,
      ),
    },
  }),
  zintlOptions,
  /**
   * `hmr` and nothing narrower. The stress, chaos, memory and performance
   * contracts all answer questions about an *application*, and this is not one
   * — it is a shape. `boundary-graph` comes free, since it introspects the
   * compiler rather than the page, and it is what proves the colony is a
   * distinct boundary rather than folded into the entry.
   */
  capabilities: ["spa", "hmr", "hmr-warm", "boundary-graph"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: HEADING,
    headingFile: "src/pages/about.ts",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
  },
};
