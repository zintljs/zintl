import { clickLocaleBar, fixtureSource, type ProjectManifest } from "@zintljs/testing";
import {
  indexHtml,
  jsxLocaleBar,
  rsbuildConfig,
  RSPACK_FIXTURE_OPTIONS,
} from "./framework-host.js";

/**
 * Preact on Rspack.
 *
 * Preact reaches the store through the same `useSyncExternalStore` path React
 * does, and that path is exactly the one Rspack has caught before: ledgers L-030
 * and L-032 record it looking correct on Vite — whose applier re-runs the entry
 * and remounts the tree for unrelated reasons — while a catalog arriving after
 * the render had nothing to repaint it here. So this is the host that can tell
 * whether the Preact facet subscribes for real or only appears to.
 */
const zintlOptions = RSPACK_FIXTURE_OPTIONS;

export const preactRspack: ProjectManifest = {
  name: "preact-rspack",
  source: fixtureSource({
    id: "preact-rspack",
    zintlOptions,
    files: {
      "rsbuild.config.mjs": rsbuildConfig({
        zintlOptions,
        entry: "./src/index.tsx",
        pluginImport: `import { pluginPreact } from "@rsbuild/plugin-preact";`,
        plugins: ["pluginPreact()"],
      }),
      "index.html": indexHtml("Preact on Rspack"),
      "src/locale-bar.tsx": jsxLocaleBar("className"),
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
        `import { useState } from "preact/hooks";`,
        `import { zintl } from "zintljs/macro";`,
        `import { LocaleBar } from "./locale-bar.tsx";`,
        ``,
        `export function App() {`,
        `  const [lang, setLang] = useState(`,
        `    () => new URLSearchParams(window.location.search).get("lang") || "en",`,
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
        `  return (`,
        `    <div key={lang}>`,
        `      <LocaleBar lang={lang} onSwitch={onSwitch} />`,
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
        `import { render } from "preact";`,
        `import { zintl } from "zintljs/macro";`,
        `import { App } from "./app.tsx";`,
        ``,
        `async function bootstrap() {`,
        `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `  await zintl(lang);`,
        `  render(<App />, document.getElementById("root")!);`,
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
        '{\n  "dir": {\n    "ar": "rtl",\n    "es": "ltr",\n    "zh": "ltr"\n  },\n  "title": {\n    "ar": "Preact على Rspack",\n    "es": "Preact en Rspack",\n    "zh": "Rspack 上的 Preact"\n  }\n}\n',
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
          name: "preact-rspack",
          private: true,
          type: "module",
          dependencies: { preact: "*" },
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
    /**
     * Rspack emits catalogs as ordinary hashed async chunks, so nothing in the
     * URL names a locale and the contract's Vite-shaped default cannot match.
     * See `LocaleSwitchAdapter.isCatalogRequest`.
     */
    isCatalogRequest: (url: string) => /\/static\/js\/async\//.test(url),
  },
};
