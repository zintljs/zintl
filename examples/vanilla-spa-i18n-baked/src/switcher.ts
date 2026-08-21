/**
 * The Zintl locale bar — the one piece of UI every example shares.
 *
 * Same markup, same class names and same behaviour on every framework and both
 * hosts, so a difference you notice between two examples is a difference in
 * *Zintl* rather than in their chrome. The React, Vue and Svelte examples render
 * this exact DOM from their own dialect; see `docs/examples-locale-bar.md`.
 */

/**
 * The locales every example offers, each written in its own language.
 *
 * They live in an array rather than in markup on purpose — a locale name must
 * never be translated, and a JS array is out of extraction's reach to begin
 * with. Where a name does reach markup, as in the template literals below, it
 * carries `@zintl-ignore` instead.
 */
const LOCALES = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
];

/**
 * The Zintl mark, inline rather than fetched.
 *
 * Inline is the only form that is identical on both hosts: it needs no `public/`
 * directory (the Rsbuild starters have none), no sprite injection (the MPA
 * examples inline theirs with `?raw`) and no second request. It is drawn in
 * `currentColor`, so it follows the bar's own colour into light or dark without
 * a filter, and it is `aria-hidden` — labelling it would put the brand name
 * into every catalog in every locale, which is precisely what it is not.
 */
const ZINTL_MARK = `
  <svg class="icon zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
    <mask id="zintl-mark-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <rect width="100" height="100" />
      <g stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none">
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
`;

/**
 * The locale controls, as links.
 *
 * Links rather than buttons because this app's locales are **baked** — each one
 * is its own document under `/<locale>/`, so switching really is a navigation
 * and deserves an element you can middle-click. The runtime-switching examples
 * render buttons for the opposite reason. Both share every class name, so the
 * bar looks and behaves the same either way.
 */
function localeSwitcher(currentLocale: string, pagePath = ""): string {
  return LOCALES.map((l) => {
    const active = currentLocale === l.id;
    return `
    <!-- @zintl-ignore -->
    <a data-lang="${l.id}" href="/${l.id}/${pagePath}" class="${active ? "active" : ""}"${
      active ? ` aria-current="true"` : ""
    }>
      ${l.name}
    </a>
  `;
  }).join("");
}

/**
 * The whole bar, links included — nothing here needs wiring after render.
 */
export function localeBar(currentLocale: string, pagePath = ""): string {
  return `
    <section id="header">
      <div id="switcher" class="switcher">${localeSwitcher(currentLocale, pagePath)}</div>
      <div class="vertical-ticks"></div>
      <div class="icon-border">${ZINTL_MARK}</div>
    </section>
    <div class="ticks"></div>
  `;
}

/** Split `/<locale>/<rest>` into the active locale and the page path under it. */
export function currentRoute(pathname: string): { locale: string; pagePath: string } {
  const segments = pathname.split("/").filter(Boolean);
  const known = LOCALES.some((l) => l.id === segments[0]);
  return {
    locale: known ? segments[0] : "en",
    pagePath: (known ? segments.slice(1) : segments).join("/"),
  };
}
