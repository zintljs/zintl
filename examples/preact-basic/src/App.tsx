import { useState } from "preact/hooks";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import "./App.css";
import LocaleSwitcher from "./components/LocaleSwitcher";

interface AppProps {
  lang: string;
  onSwitch: (newLang: string) => void;
}

/**
 * `create-vite`'s **preact-ts** starter, localized.
 *
 * Preact writes the same JSX React does, and Zintl reads it with the same
 * extraction — `preactExtractionFacet` and `reactExtractionFacet` share their
 * target list rather than each carrying a copy. What differs is one import and
 * one declaration: the subscription hook comes from `preact/compat`, not
 * `preact/hooks`, and re-running this entry is *safe* here where it is not in
 * React, because `render()` diffs against the container's existing tree instead
 * of mounting a second root over it.
 */
export function App({ lang, onSwitch }: AppProps) {
  const [count, setCount] = useState(0);

  return (
    <div key={lang} style={{ display: "contents" }}>
      <LocaleSwitcher lang={lang} onSwitch={onSwitch} />

      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <button type="button" className="counter" onClick={() => setCount((c) => c + 1)}>
          Count is {count}
        </button>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://preactjs.com/" target="_blank">
                Learn more
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </div>
  );
}
