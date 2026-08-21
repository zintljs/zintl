import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { zintl } from "zintljs/macro";

/**
 * The Zintl locale bar — the one piece of UI every example shares.
 *
 * Same markup, same class names and same behaviour on every framework and both
 * hosts, so a difference you notice between two examples is a difference in
 * *Zintl* rather than in their chrome. The vanilla, React, Preact, Solid, Vue
 * and Svelte examples render this exact DOM from their own dialect; see
 * `docs/examples-locale-bar.md`.
 *
 * **`createRenderRoot` returns `this`**, so the element renders into the light
 * DOM rather than a shadow root. That is what lets the bar's CSS — which lives
 * in the app's stylesheet like every other example's — reach it. A shadow root
 * would encapsulate the styling away and the bar would be the one piece of UI
 * that did *not* look like the others.
 */
@customElement("locale-bar")
export class LocaleBar extends LitElement {
  /** The active locale. Reflected so the bar can be styled on it if needed. */
  @property({ type: String }) lang = "en";

  /**
   * Locale names live in a JS array rather than in the template on purpose: a
   * locale name must never be translated, and an array is out of extraction's
   * reach to begin with. Everything the template *does* hold is translatable,
   * which is why nothing here needs `@zintl-ignore`.
   */
  private readonly locales = [
    { id: "en", name: "English" },
    { id: "ar", name: "العربية" },
    { id: "es", name: "Español" },
    { id: "zh", name: "中文" },
  ];

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  private async switchTo(next: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.pushState({}, "", url.pathname + url.search);
    await zintl(next);
    this.dispatchEvent(new CustomEvent("locale-change", { detail: next, bubbles: true }));
  }

  render() {
    return html`
      <section id="header">
        <div id="switcher" class="switcher">
          ${this.locales.map(
            (l) => html`
              <button
                type="button"
                data-lang=${l.id}
                class=${this.lang === l.id ? "active" : ""}
                aria-current=${this.lang === l.id ? "true" : "false"}
                @click=${() => this.switchTo(l.id)}
              >
                ${l.name}
              </button>
            `,
          )}
        </div>
        <div class="vertical-ticks"></div>
        <div class="icon-border">
          <svg class="icon zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
            <mask
              id="zintl-mark-mask"
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="100"
              height="100"
            >
              <rect width="100" height="100" />
              <g
                stroke="#fff"
                stroke-width="13"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <path d="M16 45V84" />
                <path d="M16 24v1" />
                <path d="M62 84V50" />
                <path d="M62 60a14 14 0 0 1 28 0v24" />
              </g>
              <circle cx="39" cy="52" r="21.5" />
              <circle cx="39" cy="74" r="23" />
              <circle cx="39" cy="52" r="17.5" fill="#fff" />
              <circle cx="39" cy="73" r="19" fill="#fff" />
              <circle cx="39" cy="52" r="5" />
              <circle cx="39" cy="74" r="6.5" />
            </mask>
            <rect width="100" height="100" fill="currentColor" mask="url(#zintl-mark-mask)" />
          </svg>
        </div>
      </section>
      <div class="ticks"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "locale-bar": LocaleBar;
  }
}
