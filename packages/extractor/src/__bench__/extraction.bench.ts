import { describe, bench, beforeEach } from "vite-plus/test";
import { extract, resolveTargets, type TargetDescriptor } from "../index.js";

/**
 * The sinks a real React project installs — `vanillaFacet` + `reactFacet` +
 * `htmlFacet`, inlined.
 *
 * Every `extract()` call below runs against these. Omitting them does not
 * measure a faster extractor, it measures a differently-configured one: with no targets
 * the fast-path regex reduces to `zintl|loadI18nInstance|t\(`, a JSX file with
 * no macro call misses it, and `extract` returns before parsing. That read as a
 * 60x speedup on the fast-path benchmarks while extracting nothing.
 *
 * Inlined rather than imported because the presets live in `@zintljs/compiler`,
 * and the extractor sits below the compiler — it must never depend upward.
 * Keep this list in step with those presets.
 */
const TARGETS: TargetDescriptor[] = [
  // vanillaFacet
  "dom:prop:innerHTML",
  "dom:prop:textContent",
  "dom:prop:innerText",
  "dom:prop:title",
  "dom:prop:alt",
  "dom:prop:placeholder",
  "dom:prop:aria-label",
  "dom:prop:aria-description",
  "dom:prop:value",
  // reactFacet
  "jsx:*:aria-label",
  "jsx:*:alt",
  "jsx:*:title",
  "jsx:*:placeholder",
  "jsx:*:aria-description",
  "jsx:*:label",
  "jsx:*:description",
  "jsx:*:tooltip",
  "jsx:html:dir",
  "obj:field:label",
  "obj:field:title",
  "obj:field:description",
  "obj:field:text",
  "obj:field:tooltip",
  "obj:field:placeholder",
  // htmlFacet
  "html:attr:alt",
  "html:attr:title",
  "html:attr:placeholder",
  "html:attr:aria-label",
  "html:attr:aria-description",
  "html:attr:label",
  "html:attr:description",
  "html:attr:tooltip",
  "html:attr:dir",
];

/**
 * Compiled once, exactly as the compiler does it.
 *
 * `extract` accepts either `targets` or a `compiledState`; production always
 * passes the latter (`ZintlCompiler` compiles the state at construction and
 * hands the same object to every file). Passing raw `targets` here instead
 * would rebuild a cache key on every iteration — per-call work no real build
 * ever pays.
 */
const COMPILED = resolveTargets(TARGETS);

describe("Zintl Extractor Performance", () => {
  beforeEach(() => {
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }
  });
  const shortFile = `
    import { t } from "zintl";
    export function App() {
      return <div>{t("Hello World")}</div>;
    }
  `;

  const longFile = `
    import { t } from "zintl";
    ${Array.from({ length: 100 }, (_, i) => `const msg${i} = t("Message ${i}");`).join("\n")}
    export function App() {
      return (
        <div>
          ${Array.from({ length: 100 }, (_, i) => `<p>{t("Template ${i}")}</p>`).join("\n")}
        </div>
      );
    }
  `;

  bench("Reference Calibration (No-Op)", () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      sum += Math.sin(i);
    }
  });

  bench(
    "Extract Short File",
    () => {
      extract(shortFile, "short.tsx", "short", { compiledState: COMPILED });
    },
    { time: 500, warmupTime: 500, warmupIterations: 10 },
  );

  bench(
    "Extract Long File (200 keys)",
    () => {
      extract(longFile, "long.tsx", "long", { compiledState: COMPILED });
    },
    { time: 500, warmupTime: 500, warmupIterations: 10 },
  );

  const noI18nFile = `
    export function App() {
      return <div>Pure UI without translations</div>;
    }
  `;

  bench(
    "Fast-Path (No Translations/Sinks)",
    () => {
      extract(noI18nFile, "pure.tsx", "pure", { compiledState: COMPILED });
    },
    { time: 500, warmupTime: 500, warmupIterations: 10 },
  );

  const nonUiFile = `
    export function add(a, b) {
      return a + b;
    }
  `;

  bench(
    "Fast-Path (Non-UI Logic)",
    () => {
      extract(nonUiFile, "math.ts", "math", { compiledState: COMPILED });
    },
    { time: 500, warmupTime: 500, warmupIterations: 10 },
  );
});
