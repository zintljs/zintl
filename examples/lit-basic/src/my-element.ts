import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import "./App.css";
import "./components/locale-bar.ts";

/**
 * `create-vite`'s **lit-ts** starter, localized.
 *
 * Lit is the framework that made the extractor's `tag:` descriptor necessary.
 * Its markup is neither a file format nor JSX — it is a tagged template literal
 * inside an ordinary module — so `litExtractionFacet` declares `tag:html`,
 * meaning "the contents of a template literal tagged `html` are markup". The
 * stitcher then treats it exactly as it treats `el.innerHTML = ` in a vanilla
 * app: a sentence broken across `<code>` stays one key, and `${…}` normalizes to
 * a `{name}` placeholder.
 *
 * **The light DOM, deliberately.** `createRenderRoot` returns `this` so this
 * element and the bar share the page's stylesheet. Shadow styling would work
 * fine for the app; it would just make this the one example whose chrome could
 * not be the shared one.
 */
@customElement("my-element")
export class MyElement extends LitElement {
  @state() private count = 0;
  /**
   * Named `locale`, not `lang`, because `HTMLElement` already has a `lang`
   * property — declaring a *private* one of the same name makes the class stop
   * being assignable to `HTMLElement`, which surfaces as a decorator error three
   * lines away. `locale-bar` keeps the public `lang` prop on purpose: there it
   * shadows the native attribute with the same meaning.
   */
  @state() private locale = new URLSearchParams(window.location.search).get("lang") || "en";

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("locale-change", this.onLocaleChange as EventListener);
  }

  disconnectedCallback() {
    this.removeEventListener("locale-change", this.onLocaleChange as EventListener);
    super.disconnectedCallback();
  }

  /**
   * Redraw on a locale change.
   *
   * The app does this itself rather than Zintl doing it, and that is the honest
   * shape today: a Lit element repaints when a reactive property changes or when
   * something calls `requestUpdate()` on that instance, and a module-level store
   * can reach neither. `litRuntimeFacet` leaves `repaintsOnCatalogUpdate`
   * undeclared for exactly this reason instead of claiming a repaint it cannot
   * deliver.
   */
  private readonly onLocaleChange = (event: CustomEvent<string>) => {
    this.locale = event.detail;
  };

  render() {
    return html`
      <locale-bar .lang=${this.locale}></locale-bar>

      <section id="center">
        <div class="hero">
          <img src=${heroImg} class="base" width="170" height="179" alt="" />
          <img src=${viteLogo} class="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>Edit <code>src/my-element.ts</code> and save to test <code>HMR</code></p>
        </div>
        <button type="button" class="counter" @click=${() => this.count++}>
          Count is ${this.count}
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
                <img class="logo" src=${viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://lit.dev/" target="_blank"> Learn more </a>
            </li>
          </ul>
        </div>
      </section>

      <div class="ticks"></div>
      <section id="spacer"></section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "my-element": MyElement;
  }
}
