import { useState } from "react";

const locales = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
];

interface AppProps {
  lang: string;
  onSwitch: (newLang: string) => void;
}

/**
 * The heading lives here, in a component, and that is the point of this example.
 *
 * On `examples/rsbuild-spa` the heading is written by the entry itself, so the
 * only way to repaint it is to re-run the entry — which re-runs `zintl()` and
 * rebuilds the store. Here a repaint is an ordinary React render that merely
 * re-reads the catalog, which is the distinction the vanilla-only hypothesis
 * turns on (`027-leak-ledger.md`).
 */
export default function App({ lang, onSwitch }: AppProps) {
  const [count, setCount] = useState(0);

  return (
    <div key={lang}>
      {/* @zintl-ignore */}
      <div id="switcher">
        {locales.map((l) => (
          <button
            key={l.id}
            className={lang === l.id ? "active" : ""}
            onClick={() => onSwitch(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      <h1>Get started</h1>
      <p>
        Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
      </p>

      <button id="counter" type="button" onClick={() => setCount((c) => c + 1)}>
        Count is {count}
      </button>

      <h2>Documentation</h2>
      <p>Your questions, answered</p>
    </div>
  );
}
