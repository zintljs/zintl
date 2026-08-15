import { useState } from "react";
import "./App.css";

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
 * `create-rsbuild`'s React starter, with a locale switcher bolted on.
 *
 * The heading lives here, in a component, and that is the point of this example.
 * On `examples/rsbuild-vanilla-basic` the heading is written by the entry
 * itself, so the only way to repaint it is to re-run the entry — which re-runs
 * `zintl()` and rebuilds the store. Here a repaint is an ordinary React render
 * that merely re-reads the catalog, which is why this app hot-updates on Rspack
 * where the vanilla one reloads (ledger L-032, L-035).
 */
export default function App({ lang, onSwitch }: AppProps) {
  const [count, setCount] = useState(0);

  return (
    <div key={lang} className="content">
      {/* @zintl-ignore */}
      <div id="switcher" className="switcher">
        {locales.map((l) => (
          <button
            key={l.id}
            type="button"
            className={lang === l.id ? "active" : ""}
            onClick={() => onSwitch(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      <h1>Rsbuild with React</h1>
      <p>Start building amazing things with Rsbuild.</p>
      <p>
        Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
      </p>

      <button id="counter" type="button" className="counter" onClick={() => setCount((c) => c + 1)}>
        Count is {count}
      </button>
    </div>
  );
}
