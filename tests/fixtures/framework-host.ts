import type { ZintlPluginOptions } from "@zintljs/testing";

/**
 * What the three framework-on-Rspack fixtures share.
 *
 * `preact-rspack`, `solid-rspack` and `lit-rspack` each ask one narrow question
 * — "does this facet work on the second host" — and the answer should not depend
 * on three different hand-written harnesses. So the host config, the document and
 * the Zintl mark live here, and each fixture contributes only the part that is
 * actually its dialect.
 *
 * A fixture rather than three more example applications, per
 * `tests/manifests/index.ts`: cost is roughly (projects × matching contracts),
 * and `examples/{preact,solid,lit}-basic` are already the integration truth on
 * Vite. What these add is the host, which is the axis a facet can accidentally
 * depend on — ledgers L-030 and L-032 both record client reactivity looking
 * correct on Vite, whose module ordering hides a late catalog, and being broken
 * on Rspack, where nothing re-runs the component.
 */
export const RSPACK_FIXTURE_OPTIONS: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
  outputDir: "./src/i18n",
  catalogFormat: "translations.json",
  similarityThreshold: 0.01,
};

/**
 * The Rsbuild config the harness's `RsbuildDriver` actually reads.
 *
 * Authored rather than generated: `fixtureSource` only ever synthesizes a
 * `vite.config.ts`. `html.template` and an explicit `source.entry` are both
 * required rather than stylistic — see `examples/rsbuild-vanilla-basic`'s config
 * for why (no source template means nothing for the HTML projection to write
 * into, and `htmlEntries` is read from this file, ledger L-021).
 */
export function rsbuildConfig(opts: {
  zintlOptions: ZintlPluginOptions;
  entry: string;
  pluginImport?: string;
  plugins?: string[];
}): string {
  const extra = opts.plugins?.length ? `,\n    ${opts.plugins.join(",\n    ")}` : "";
  return [
    `import { defineConfig } from "@rsbuild/core";`,
    `import zintl from "zintljs/rsbuild";`,
    ...(opts.pluginImport ? [opts.pluginImport] : []),
    ``,
    `export default defineConfig({`,
    `  plugins: [`,
    `    ...zintl(${JSON.stringify(opts.zintlOptions, null, 6).replace(/\n/g, "\n    ")})${extra}`,
    `  ],`,
    `  source: { entry: { index: ${JSON.stringify(opts.entry)} } },`,
    `  html: { template: "./index.html" },`,
    `});`,
    ``,
  ].join("\n");
}

export function indexHtml(title: string): string {
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `  <head>`,
    `    <meta charset="UTF-8" />`,
    `    <title>${title}</title>`,
    `  </head>`,
    `  <body>`,
    `    <div id="root"></div>`,
    `  </body>`,
    `</html>`,
    ``,
  ].join("\n");
}

/** The locales the bar offers, in the order it renders them. */
export const FIXTURE_LOCALES = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
];

/**
 * The Zintl mark, as markup.
 *
 * The real one, not a stand-in: `locale-bar.contract.spec.ts` checks that it is
 * `aria-hidden` and drawn in `currentColor`, and a fixture that satisfied those
 * with a simplified shape would be vouching for something it is not rendering.
 *
 * `jsx` swaps the two attributes JSX spells differently. Everything else is
 * identical in all three dialects, which is the point.
 */
export function zintlMark(dialect: "jsx" | "html"): string {
  const strokeWidth = dialect === "jsx" ? "strokeWidth" : "stroke-width";
  const linecap = dialect === "jsx" ? "strokeLinecap" : "stroke-linecap";
  const linejoin = dialect === "jsx" ? "strokeLinejoin" : "stroke-linejoin";
  return [
    `<svg class="icon zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">`,
    `  <mask id="zintl-mark-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">`,
    `    <rect width="100" height="100" />`,
    `    <g stroke="#fff" ${strokeWidth}="13" ${linecap}="round" ${linejoin}="round" fill="none">`,
    `      <path d="M16 45V84" /><path d="M16 24v1" />`,
    `      <path d="M62 84V50" /><path d="M62 60a14 14 0 0 1 28 0v24" />`,
    `    </g>`,
    `    <circle cx="39" cy="52" r="21.5" /><circle cx="39" cy="74" r="23" />`,
    `    <circle cx="39" cy="52" r="17.5" fill="#fff" /><circle cx="39" cy="73" r="19" fill="#fff" />`,
    `    <circle cx="39" cy="52" r="5" /><circle cx="39" cy="74" r="6.5" />`,
    `  </mask>`,
    `  <rect width="100" height="100" fill="currentColor" mask="url(#zintl-mark-mask)" />`,
    `</svg>`,
  ].join("\n");
}

/** `class` in Solid and Lit, `className` in Preact — the only attribute that moves. */
export function jsxLocaleBar(classAttr: "class" | "className"): string {
  const mark = zintlMark("jsx")
    .replace(/class="icon zintl-mark"/, `${classAttr}="icon zintl-mark"`)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `        ${line}`))
    .join("\n");
  return [
    `const locales = ${JSON.stringify(FIXTURE_LOCALES, null, 2)};`,
    ``,
    `interface Props {`,
    `  lang: string;`,
    `  onSwitch: (lang: string) => void;`,
    `}`,
    ``,
    `export function LocaleBar(props: Props) {`,
    `  return (`,
    `    <>`,
    `      {/* @zintl-ignore */}`,
    `      <section id="header">`,
    `        <div id="switcher" ${classAttr}="switcher">`,
    `          {locales.map((l) => (`,
    `            <button`,
    `              type="button"`,
    `              data-lang={l.id}`,
    `              ${classAttr}={props.lang === l.id ? "active" : ""}`,
    `              aria-current={props.lang === l.id ? "true" : undefined}`,
    `              onClick={() => props.onSwitch(l.id)}`,
    `            >`,
    `              {l.name}`,
    `            </button>`,
    `          ))}`,
    `        </div>`,
    `        <div ${classAttr}="vertical-ticks"></div>`,
    `        <div ${classAttr}="icon-border">`,
    `        ${mark}`,
    `        </div>`,
    `      </section>`,
    `      <div ${classAttr}="ticks"></div>`,
    `    </>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
}
