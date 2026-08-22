import { For } from "solid-js";

/**
 * The Zintl locale bar — the one piece of UI every example shares.
 *
 * Same markup, same class names and same behaviour on every framework and both
 * hosts, so a difference you notice between two examples is a difference in
 * *Zintl* rather than in their chrome. See `docs/examples-locale-bar.md`.
 *
 * **`props` is read, never destructured.** Solid compiles JSX props into
 * getters, so `props.lang` is a tracked read while `const { lang } = props` is a
 * one-time snapshot that never updates again. That is the only Solid-specific
 * thing in this file, and it is what makes the active locale follow the switch.
 */
interface Props {
  lang: string;
  onSwitch: (lang: string) => void;
}

/**
 * The locales every example offers, each written in its own language.
 *
 * An array rather than markup, on purpose: a locale name must never be
 * translated, and a JS array is out of extraction's reach to begin with. The
 * `@zintl-ignore` below covers the JSX that renders them.
 */
const locales = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
];

/**
 * The Zintl mark, inline rather than fetched — drawn in `currentColor`, so it
 * follows the bar into light or dark without a filter, and `aria-hidden`, since
 * labelling it would put the brand name into every catalog in every locale.
 */
function ZintlMark() {
  return (
    <svg class="icon zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
      <mask id="zintl-mark-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
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
  );
}

export default function LocaleSwitcher(props: Props) {
  return (
    <>
      {/* @zintl-ignore */}
      <section id="header">
        <div id="switcher" class="switcher">
          <For each={locales}>
            {(l) => (
              <button
                type="button"
                data-lang={l.id}
                class={props.lang === l.id ? "active" : ""}
                aria-current={props.lang === l.id ? "true" : undefined}
                onClick={() => props.onSwitch(l.id)}
              >
                {l.name}
              </button>
            )}
          </For>
        </div>
        <div class="vertical-ticks"></div>
        <div class="icon-border">
          <ZintlMark />
        </div>
      </section>
      <div class="ticks"></div>
    </>
  );
}
