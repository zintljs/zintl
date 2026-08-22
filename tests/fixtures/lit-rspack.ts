import { clickLocaleBar, fixtureSource, type ProjectManifest } from "@zintljs/testing";
import {
  FIXTURE_LOCALES,
  indexHtml,
  rsbuildConfig,
  RSPACK_FIXTURE_OPTIONS,
  zintlMark,
} from "./framework-host.js";

/**
 * Lit on Rspack.
 *
 * No framework plugin, and that is the point rather than an omission: Lit is a
 * library, not a compiler, so `create-rsbuild`'s lit template ships none either.
 * What this fixture proves is that the `tag:html` extraction and the
 * `unsafeHTML` codegen import survive a second bundler — the import in
 * particular, since `codegenImports` was added for Lit and had exactly one
 * consumer when it was written.
 */
const zintlOptions = RSPACK_FIXTURE_OPTIONS;

const mark = zintlMark("html")
  .split("\n")
  .map((line, i) => (i === 0 ? line : `            ${line}`))
  .join("\n");

export const litRspack: ProjectManifest = {
  name: "lit-rspack",
  source: fixtureSource({
    id: "lit-rspack",
    zintlOptions,
    files: {
      "rsbuild.config.mjs": rsbuildConfig({ zintlOptions, entry: "./src/index.ts" }),
      "index.html": indexHtml("Lit on Rspack"),
      /**
       * The element lives in its own file, not beside the anchor in the entry.
       *
       * That is how every real example is laid out, and it is load-bearing: a
       * component declared *inside* the entry forms a nested boundary the entry's
       * manager does not seed, so the page renders with the bar intact and every
       * translated string empty.
       */
      "src/app-root.ts": [
        `import { LitElement, html } from "lit";`,
        `import { customElement, state } from "lit/decorators.js";`,
        `import { zintl } from "zintljs/macro";`,
        ``,
        `const locales = ${JSON.stringify(FIXTURE_LOCALES, null, 2)};`,
        ``,
        `@customElement("app-root")`,
        `export class AppRoot extends LitElement {`,
        `  // \`accessor\`, where \`examples/lit-basic\` writes a plain field. Rsbuild`,
        `  // compiles with SWC, which applies **standard** decorators and ignores`,
        `  // tsconfig's \`experimentalDecorators\` entirely — a decorated plain field`,
        `  // then fails at class-init time with "Unsupported decorator location:`,
        `  // field". A host difference rather than a Zintl one, and the kind only a`,
        `  // second host reveals.`,
        `  @state() accessor locale =`,
        `    new URLSearchParams(window.location.search).get("lang") || "en";`,
        ``,
        `  protected createRenderRoot(): HTMLElement {`,
        `    return this;`,
        `  }`,
        ``,
        `  private async switchTo(next: string) {`,
        `    const url = new URL(window.location.href);`,
        `    url.searchParams.set("lang", next);`,
        `    window.history.pushState({}, "", url.pathname + url.search);`,
        `    await zintl(next);`,
        `    this.locale = next;`,
        `  }`,
        ``,
        `  render() {`,
        `    return html\``,
        `      <section id="header">`,
        `        <div id="switcher" class="switcher">`,
        `          \${locales.map(`,
        `            (l) => html\`<button`,
        `              type="button"`,
        `              data-lang=\${l.id}`,
        `              class=\${this.locale === l.id ? "active" : ""}`,
        `              aria-current=\${this.locale === l.id ? "true" : "false"}`,
        `              @click=\${() => this.switchTo(l.id)}`,
        `            >`,
        `              \${l.name}`,
        `            </button>\`,`,
        `          )}`,
        `        </div>`,
        `        <div class="vertical-ticks"></div>`,
        `        <div class="icon-border">`,
        `            ${mark}`,
        `        </div>`,
        `      </section>`,
        `      <div class="ticks"></div>`,
        ``,
        `      <h1>Get started</h1>`,
        `      <p>Edit <code>src/index.ts</code> and save to test <code>HMR</code></p>`,
        `    \`;`,
        `  }`,
        `}`,
        ``,
      ].join("\n"),
      "src/index.ts": [
        `import { zintl } from "zintljs/macro";`,
        `import "./app-root.ts";`,
        ``,
        `async function bootstrap() {`,
        `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";`,
        `  await zintl(lang);`,
        `  document.getElementById("root")!.appendChild(document.createElement("app-root"));`,
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
        '{\n  "dir": {\n    "ar": "rtl",\n    "es": "ltr",\n    "zh": "ltr"\n  },\n  "title": {\n    "ar": "Lit على Rspack",\n    "es": "Lit en Rspack",\n    "zh": "Rspack 上的 Lit"\n  }\n}\n',
      /**
       * Shipped, not generated. `verifyIntegrity` is on for builds, so a fixture
       * claiming `"build"` has to arrive with its translations the way a real
       * project does — otherwise the build fails on a missing key and the
       * contract reports a Zintl defect that is really an empty catalog.
       */
      "src/i18n/translations.json":
        '{\n  "Get started": {\n    "ar": "البدء",\n    "es": "Empezar",\n    "zh": "开始"\n  },\n  "Edit <code>src/index.ts</code> and save to test <code>HMR</code>": {\n    "ar": "عدل <code>src/index.ts</code> واحفظه لاختبار <code>HMR</code>",\n    "es": "Edita <code>src/index.ts</code> y guarda para probar <code>HMR</code>",\n    "zh": "编辑 <code>src/index.ts</code> 并保存以测试 <code>HMR</code>"\n  }\n}\n',
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
          name: "lit-rspack",
          private: true,
          type: "module",
          dependencies: { lit: "*" },
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
    headingFile: "src/app-root.ts",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
    isCatalogRequest: (url: string) => /\/static\/js\/async\//.test(url),
  },
};
