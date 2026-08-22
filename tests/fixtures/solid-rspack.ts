import { clickLocaleBar, fixtureSource, type ProjectManifest } from "@zintljs/testing";
import {
  indexHtml,
  jsxLocaleBar,
  rsbuildConfig,
  RSPACK_FIXTURE_OPTIONS,
} from "./framework-host.js";

/**
 * Solid on Rspack.
 *
 * The host that matters most for this facet. Solid takes its dependency on the
 * store through a `reactiveBridge` rather than a subscription hook, and Vite
 * cannot tell you whether that bridge works: its applier re-runs the entry on a
 * boundary update, remounting the tree against the new catalog whether or not
 * anything reactive happened. Rspack does not, which is precisely how ledger
 * L-069 found the same class of defect in Vue's bridge.
 */
const zintlOptions = RSPACK_FIXTURE_OPTIONS;

export const solidRspack: ProjectManifest = {
  name: "solid-rspack",
  source: fixtureSource({
    id: "solid-rspack",
    zintlOptions,
    files: {
      "rsbuild.config.mjs": rsbuildConfig({
        zintlOptions,
        entry: "./src/index.tsx",
        pluginImport: `import { pluginSolid } from "@rsbuild/plugin-solid";\nimport { pluginBabel } from "@rsbuild/plugin-babel";`,
        plugins: ["pluginBabel({ include: /\\.(?:jsx|tsx)$/ })", "pluginSolid()"],
      }),
      "index.html": indexHtml("Solid on Rspack"),
      "src/locale-bar.tsx": jsxLocaleBar("class"),
      /**
       * The component lives in its own file, not beside the anchor in the entry.
       *
       * That is how every real example is laid out, and it is load-bearing: a
       * component declared *inside* the entry forms a nested boundary that the
       * entry's manager does not seed, so the page renders with the bar intact
       * and every translated string empty. Worth knowing when writing a fixture
       * — the layout is part of what is under test.
       */
      "src/app.tsx": [
        `import { createSignal } from "solid-js";`,
        `import { zintl } from "zintljs/macro";`,
        `import { LocaleBar } from "./locale-bar.tsx";`,
        ``,
        `export function App() {`,
        `  const [lang, setLang] = createSignal(`,
        `    new URLSearchParams(window.location.search).get("lang") || "en",`,
        `  );`,
        ``,
        `  const onSwitch = async (next: string) => {`,
        `    const url = new URL(window.location.href);`,
        `    url.searchParams.set("lang", next);`,
        `    window.history.pushState({}, "", url.pathname + url.search);`,
        `    await zintl(next);`,
        `    setLang(next);`,
        `  };`,
        ``,
        `  /* No remount wrapper, deliberately: if the reactive bridge works these`,
        `     strings update in place, and if it does not this fixture fails —`,
        `     which is the whole reason it exists. */`,
        `  return (`,
        `    <div>`,
        `      <LocaleBar lang={lang()} onSwitch={onSwitch} />`,
        `      <h1>Get started</h1>`,
        `      <p>`,
        `        Edit <code>src/index.tsx</code> and save to test <code>HMR</code>`,
        `      </p>`,
        `    </div>`,
        `  );`,
        `}`,
        ``,
      ].join("\n"),
      "src/index.tsx": [
        `import { render } from "solid-js/web";`,
        `import { zintl } from "zintljs/macro";`,
        `import { App } from "./app.tsx";`,
        ``,
        `async function bootstrap() {`,
        `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `  await zintl(lang);`,
        `  render(() => <App />, document.getElementById("root")!);`,
        `}`,
        ``,
        `void bootstrap();`,
        ``,
      ].join("\n"),
      /**
       * The document's own catalog, and `dir` is the reason it exists.
       *
       * Switching to Arabic sets the store's locale and delivers the catalog
       * without it — what stays wrong is `<html dir>`, because the direction per
       * locale is a property of the *document*, projected from here. A fixture
       * that skips this file switches locale correctly and still fails `rtl`.
       */
      "src/i18n/index.html.translations.json":
        '{\n  "dir": {\n    "ar": "rtl",\n    "es": "ltr",\n    "zh": "ltr"\n  },\n  "title": {\n    "ar": "Solid على Rspack",\n    "es": "Solid en Rspack",\n    "zh": "Rspack 上的 Solid"\n  }\n}\n',
      /**
       * Shipped, not generated. `verifyIntegrity` is on for builds, so a fixture
       * claiming `"build"` has to arrive with its translations the way a real
       * project does — otherwise the build fails on a missing key and the
       * contract reports a Zintl defect that is really an empty catalog.
       */
      "src/i18n/translations.json":
        '{\n  "Get started": {\n    "ar": "البدء",\n    "es": "Empezar",\n    "zh": "开始"\n  },\n  "Edit <code>src/index.tsx</code> and save to test <code>HMR</code>": {\n    "ar": "عدل <code>src/index.tsx</code> واحفظه لاختبار <code>HMR</code>",\n    "es": "Edita <code>src/index.tsx</code> y guarda para probar <code>HMR</code>",\n    "zh": "编辑 <code>src/index.tsx</code> 并保存以测试 <code>HMR</code>"\n  }\n}\n',
      /**
       * The dependency is declared, not decorative. `detectFrameworks` reads it
       * to decide which facet activates — a fixture with an empty `package.json`
       * gets no framework at all, extraction finds nothing, and the page renders
       * in the source locale looking deceptively fine. Resolution itself comes
       * from the walk-up to the root `node_modules`, which is why the version is
       * a wildcard rather than a range nobody would maintain.
       */
      "package.json": JSON.stringify(
        {
          name: "solid-rspack",
          private: true,
          type: "module",
          dependencies: { "solid-js": "*" },
        },
        null,
        2,
      ),
    },
  }),
  driver: "rsbuild",
  zintlOptions,
  capabilities: ["spa", "locale-switch", "rtl", "build", "transform"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/app.tsx",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
    isCatalogRequest: (url: string) => /\/static\/js\/async\//.test(url),
  },
};
