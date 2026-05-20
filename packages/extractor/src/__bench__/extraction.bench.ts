import { describe, bench, beforeEach } from "vite-plus/test";
import { extract } from "../index.js";

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
      extract(shortFile, "short.tsx", "short");
    },
    { time: 500, warmupTime: 500, warmupIterations: 10 },
  );

  bench(
    "Extract Long File (200 keys)",
    () => {
      extract(longFile, "long.tsx", "long");
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
      extract(noI18nFile, "pure.tsx", "pure");
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
      extract(nonUiFile, "math.ts", "math");
    },
    { time: 500, warmupTime: 500, warmupIterations: 10 },
  );
});
