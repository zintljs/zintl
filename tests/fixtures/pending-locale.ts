import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

/**
 * A locale being stood up: maintained on disk, shipped nowhere (031).
 *
 * The unit tests prove the *cause* — the generated Manager has no `de` case, so
 * nothing imports German content and the bundler has no module to emit. This
 * fixture is the corroboration a compiler-level assertion cannot give: a real
 * Rolldown build, run through the gate, of a project whose German is
 * deliberately half-finished.
 *
 * Two claims live here, and both are ones only a real build makes. The build is
 * **green** with `de` at 1/2 translated, which is exactly the red build 031
 * exists to remove — and `ar`, at 2/2, is still gated, which is the half
 * `verifyIntegrity: false` throws away. The `dist-output` snapshot then records
 * which catalog chunks were emitted, and German is not among them.
 *
 * A fixture rather than an example: the question is one feature against one
 * framework, and the manifest list is not free.
 */
const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar"],
  pendingLocales: ["de"],
  outputDir: "./src/locales",
};

const HEADING = "Welcome back!";
const SUBHEADING = "Your projects are waiting.";

export const pendingLocale: ProjectManifest = {
  name: "pending-locale",
  source: fixtureSource({
    id: "pending-locale",
    zintlOptions,
    files: {
      "index.html": [
        `<!doctype html>`,
        `<html lang="en">`,
        `  <head><meta charset="UTF-8" /><title>Pending locale fixture</title></head>`,
        `  <body>`,
        `    <div id="app"></div>`,
        `    <script type="module" src="/src/main.ts"></script>`,
        `  </body>`,
        `</html>`,
        ``,
      ].join("\n"),

      // Arabic ships, so it is complete — anything less fails the build, which
      // is the protection a pending locale must not cost.
      "src/locales/src/main.ar.json": JSON.stringify(
        { [HEADING]: "مرحباً بعودتك!", [SUBHEADING]: "مشاريعك في انتظارك." },
        null,
        2,
      ),

      /**
       * German, half-finished on purpose.
       *
       * 0% would pass for a weaker reason — an untouched locale could plausibly
       * be one the compiler never noticed. A partial catalog is unambiguous: the
       * keys are extracted, one is filled, and the build passes anyway.
       */
      "src/locales/src/main.de.json": JSON.stringify(
        { [HEADING]: "Willkommen zurück!", [SUBHEADING]: "" },
        null,
        2,
      ),

      /**
       * The anchor is **top-level**, and that is load-bearing rather than
       * style. A `zintl()` nested inside a function makes the file a boundary
       * but not an entry point, and `verifyIntegrity` returns early on a graph
       * with no entries — so the same fixture written with `async function
       * render()` builds green whatever its catalogs say, and would assert
       * nothing at all.
       */
      "src/main.ts": [
        `import { zintl } from "zintljs/macro";`,
        ``,
        `const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `await zintl(lang);`,
        ``,
        `document.querySelector<HTMLDivElement>("#app")!.innerHTML =`,
        `  \`<h1 id="heading">${HEADING}</h1><p id="sub">${SUBHEADING}</p>\`;`,
        ``,
      ].join("\n"),
    },
  }),
  zintlOptions,
  /**
   * `spa` for the render, `build` for the output. Deliberately not
   * `locale-switch`: German is the interesting locale here and it is precisely
   * the one no switcher may offer, so a switching contract would be asserting
   * against Arabic and telling us nothing 031 did not already know.
   */
  capabilities: ["spa", "build"],
  adapter: {
    headingSelector: "#heading",
    initialHeadingText: HEADING,
    headingFile: "src/main.ts",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/?lang=${locale}`);
    },
  },
};
