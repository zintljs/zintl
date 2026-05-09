import { describe, bench } from "vite-plus/test";
import { extract } from "../index.js";

describe("Zintl Extractor Performance", () => {
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
    extract("", "x.js", "x");
  });

  bench("Extract Short File", () => {
    extract(shortFile, "short.tsx", "short");
  });

  bench("Extract Long File (200 keys)", () => {
    extract(longFile, "long.tsx", "long");
  });

  const noI18nFile = `
    export function App() {
      return <div>Pure UI without translations</div>;
    }
  `;

  bench("Fast-Path (No Translations/Sinks)", () => {
    extract(noI18nFile, "pure.tsx", "pure");
  });

  const nonUiFile = `
    export function add(a, b) {
      return a + b;
    }
  `;

  bench("Fast-Path (Non-UI Logic)", () => {
    extract(nonUiFile, "math.ts", "math");
  });
});
