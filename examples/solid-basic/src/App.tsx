import { createSignal } from "solid-js";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import "./App.css";
import LocaleSwitcher from "./components/LocaleSwitcher";

/**
 * `create-vite`'s **solid-ts** starter, localized.
 *
 * Solid is the case that shows why `clientReactivityImports` is not the only
 * reactivity mechanism a facet can declare. A Solid component runs **once**:
 * its JSX compiles into fine-grained effects, and an effect re-runs only when a
 * signal it read during its last run changes. Subscribing the component would
 * therefore change nothing — there is no second render to trigger.
 *
 * So `solidCodegenFacet` contributes a `reactiveBridge` instead: a module-level
 * signal mirroring the store, spliced into every generated `_t` call. Rendering
 * a translation *is* reading that signal, so each sink takes the dependency by
 * construction — which is why nothing below re-mounts on a locale change and
 * every string still updates.
 *
 * Note what is *not* here as a result: no `key={lang}` remount wrapper. React,
 * Preact, Vue and Svelte all use one; Solid does not need it, and adding one
 * would throw away the fine-grained updates that are the point of the framework.
 */
interface AppProps {
  lang: string;
  onSwitch: (lang: string) => void;
}

export default function App(props: AppProps) {
  const [count, setCount] = createSignal(0);

  return (
    <>
      {/* `props.lang`, never destructured — Solid compiles props into getters,
          so pulling `lang` out of them takes a snapshot that never updates. */}
      <LocaleSwitcher lang={props.lang} onSwitch={props.onSwitch} />

      <section id="center">
        <div class="hero">
          <img src={heroImg} class="base" width="170" height="179" alt="" />
          <img src={viteLogo} class="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <button type="button" class="counter" onClick={() => setCount(count() + 1)}>
          Count is {count()}
        </button>
      </section>

      <div class="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg class="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img class="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://solidjs.com/" target="_blank">
                Learn more
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div class="ticks"></div>
      <section id="spacer"></section>
    </>
  );
}
