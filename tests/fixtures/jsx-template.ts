import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

/**
 * A template literal inside JSX, rendered by a real browser.
 *
 * **The hole this fills was found by falling into it.** A template literal in a
 * JSX expression container lost its interpolations entirely: the JSX visitor
 * kept its own copy of the placeholder-name derivation that handled only
 * `Identifier`, so `${user.firstName}` was named `var0` there and
 * `user_firstName` in the extracted text. Bindings pair to placeholders by
 * name, so the mismatch dropped the binding rather than mis-naming it, and the
 * emitted call carried no params at all:
 *
 * ```js
 * _t("Welcome back, {user_firstName}!", { _mgr, _bId })
 * ```
 *
 * The value then never reached the page. Measured by reverting the fix under
 * this fixture, the built page renders `Welcome back, undefined!` — the baked
 * source locale resolves the placeholder through `params["user_firstName"]`,
 * and nothing put it there. It survived because **no project in the manifest uses a template
 * literal inside JSX** — `examples/vanilla-ssr` uses one on a DOM assignment,
 * which takes the route through the extractor that was already correct, and
 * every JSX project writes plain JSX children. So the suite had two well-covered
 * halves of one feature and nothing across the join.
 *
 * A fixture rather than a new example, per `tests/manifests/index.ts`: the
 * question is "does this syntax bind its variables", not "does this application
 * work". Preact rather than React because only Preact resolves from the
 * repository root, and JSX via esbuild rather than a framework plugin because
 * the visitor under test is framework-blind — it walks `JSXExpressionContainer`
 * and has never known which library renders it.
 *
 * Not `locale-switch`: that contract asks about `<html dir>`, store coherence
 * and catalog fetching, none of which is what broke here, and claiming it would
 * enrol this in the RTL and locale-bar contracts to assert an interpolation.
 * `spa` renders the page and `build` records the emitted call — between them
 * every claim this fixture exists to make is covered.
 */
const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar"],
  outputDir: "./src/locales",
};

/** The value that must reach the page. Not a translated string — a binding. */
const NAME = "Ada";
const HEADING = `Welcome back, ${NAME}!`;

export const jsxTemplate: ProjectManifest = {
  name: "jsx-template",
  source: fixtureSource({
    id: "jsx-template",
    zintlOptions,
    files: {
      /**
       * Authored rather than generated, for the JSX. Vite compiles `.tsx`
       * through esbuild on its own, so the automatic runtime plus an import
       * source is the whole of what a framework plugin would have set up here —
       * and this fixture wants none of the rest of one (Fast Refresh has no
       * bearing on whether a placeholder is bound).
       */
      "vite.config.ts": [
        `import { defineConfig } from "vite";`,
        `import zintl from "zintljs/vite";`,
        ``,
        `export default defineConfig({`,
        `  logLevel: "silent",`,
        `  esbuild: { jsx: "automatic", jsxImportSource: "preact" },`,
        // Both pages declared, so the build emits both. Dev serves either from
        // disk without being told.
        `  build: { rollupOptions: { input: { index: "index.html", module: "module.html" } } },`,
        `  plugins: [zintl(${JSON.stringify(zintlOptions, null, 2)})],`,
        `});`,
        ``,
      ].join("\n"),

      "index.html": [
        `<!doctype html>`,
        `<html lang="en">`,
        `  <head><meta charset="UTF-8" /><title>JSX template fixture</title></head>`,
        `  <body>`,
        `    <div id="root"></div>`,
        `    <script type="module" src="/src/main.tsx"></script>`,
        `  </body>`,
        `</html>`,
        ``,
      ].join("\n"),

      /**
       * The component lives outside the entry, which is load-bearing rather
       * than tidy: a component declared *inside* the entry forms a nested
       * boundary the entry's manager does not seed, and the page then renders
       * with every translated string empty. Same reason `preact-rspack` is laid
       * out this way.
       */
      "src/greeting.tsx": [
        `export function Greeting({ user }: { user: { firstName: string } }) {`,
        `  return (`,
        `    <div>`,
        // The child position — the shape that was broken, and the one the
        // `spa` contract reads back out of the DOM.
        '      <h1 id="greeting">{`Welcome back, ${user.firstName}!`}</h1>',
        // The attribute position, broken by the same cause and through the same
        // code path. Nothing reads an `alt` out of the DOM, so this one is
        // carried by the `build` snapshot rather than by an assertion.
        '      <img id="portrait" alt={`Portrait of ${user.firstName}`} src="/p.png" />',
        `    </div>`,
        `  );`,
        `}`,
        ``,
      ].join("\n"),

      /**
       * `bootstrap()` rather than a top-level `await`, matching
       * `examples/preact-basic` and `preact-rspack`. Not stylistic: top-level
       * await makes the entry an async module, which moves when its manager
       * evaluates relative to the component — and a fixture written that way
       * renders the source locale pseudo-localized, so it would be testing two
       * things and failing on the one it does not name.
       */
      "src/main.tsx": [
        `import { render } from "preact";`,
        `import { zintl } from "zintljs/macro";`,
        `import { Greeting } from "./greeting.tsx";`,
        ``,
        `async function bootstrap() {`,
        `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `  await zintl(lang);`,
        `  render(<Greeting user={{ firstName: ${JSON.stringify(NAME)} }} />, document.getElementById("root")!);`,
        `}`,
        ``,
        `void bootstrap();`,
        ``,
      ].join("\n"),

      /**
       * Shipped, not generated. `verifyIntegrity` is on for builds, so a fixture
       * claiming `"build"` arrives with its translations the way a real project
       * does — otherwise the build fails on an empty catalog and the contract
       * reports a Zintl defect that is really a missing file.
       *
       * Both Arabic strings keep the `{user_firstName}` placeholder, which is
       * not decoration: it means the *translated* path carries an interpolation
       * too, so a binding that only worked in the source locale would still be
       * visible here.
       */
      "src/locales/src/greeting.tsx.Greeting.ar.json": JSON.stringify(
        {
          "Portrait of {user_firstName}": "صورة {user_firstName}",
          "Welcome back, {user_firstName}!": "مرحباً بعودتك يا {user_firstName}!",
        },
        null,
        2,
      ),

      /**
       * The second page, and the reason this fixture has two.
       *
       * CLAUDE.md defines an entry point as "a file with a **top-level**
       * `zintl()` call", and that shape was broken for `.tsx` and `.jsx`
       * projects: codegen normalized `src/main.tsx` to `src/main` while the
       * graph kept the extension, so the generated manager named a chunk that
       * did not exist. It loaded with a 200 and registered no catalog, and every
       * string in any *other* boundary rendered pseudo-localized.
       *
       * It survived because no project in the manifest used it — every example
       * wraps `render` in `bootstrap()`, which puts the anchor in function scope
       * where the bug cannot reach. The two pages here differ in exactly that
       * one respect and share everything else, including the component and its
       * catalog, so a divergence between them is about anchor scope and nothing
       * else.
       */
      "module.html": [
        `<!doctype html>`,
        `<html lang="en">`,
        `  <head><meta charset="UTF-8" /><title>Module-scope anchor</title></head>`,
        `  <body>`,
        `    <div id="root"></div>`,
        `    <script type="module" src="/src/main-module.tsx"></script>`,
        `  </body>`,
        `</html>`,
        ``,
      ].join("\n"),

      "src/main-module.tsx": [
        `import { render } from "preact";`,
        `import { zintl } from "zintljs/macro";`,
        `import { Greeting } from "./greeting.tsx";`,
        ``,
        `const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `await zintl(lang);`,
        `render(<Greeting user={{ firstName: ${JSON.stringify(NAME)} }} />, document.getElementById("root")!);`,
        ``,
      ].join("\n"),

      /**
       * Declared so `detectFrameworks` activates the Preact facet. An empty
       * `package.json` yields no framework, extraction finds nothing, and the
       * page renders in the source locale looking deceptively correct — which
       * for this fixture would mean passing for the wrong reason. Resolution
       * itself comes from the walk up to the root `node_modules`, hence the
       * wildcard.
       */
      "package.json": JSON.stringify(
        { name: "jsx-template", private: true, type: "module", dependencies: { preact: "*" } },
        null,
        2,
      ),
    },
  }),
  zintlOptions,
  capabilities: ["spa", "build"],
  adapter: {
    headingSelector: "#greeting",
    /**
     * The whole assertion, and it is an ordinary one on purpose. A broken build
     * renders `Welcome back, {user_firstName}!` here — the placeholder itself,
     * shown to a user — so the existing initial-render contract catches the
     * regression without needing to know anything about interpolation.
     */
    initialHeadingText: HEADING,
    headingFile: "src/greeting.tsx",
    /**
     * The **module-scope** page, deliberately.
     *
     * The coverage is asymmetric and the asymmetry is the point: `initial-render`
     * visits one page, and it should be the one that was broken. The
     * `bootstrap()` page is covered by the `dist-output` snapshot here and by
     * every example in the suite, so it is the better one to leave to a
     * snapshot.
     */
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/module.html`);
    },
    navigateLocale: async (lab, locale) => {
      await lab.page.goto(`${lab.url}/module.html?lang=${locale}`);
    },
  },
};
