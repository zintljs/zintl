"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";

/**
 * The Zintl locale bar — the one piece of UI every example shares.
 *
 * Same markup, same class names and same behaviour on every framework and both
 * hosts, so a difference you notice between two examples is a difference in
 * *Zintl* rather than in their chrome. The vanilla, React, Vue and Svelte
 * examples render this exact DOM from their own dialect; see
 * `docs/examples-locale-bar.md`.
 *
 * Links rather than buttons, because the locale is a route segment here: a
 * switch really is a navigation, and deserves an element you can middle-click.
 * The runtime-switching examples call `zintl(lang)` and repaint in place.
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
    <svg className="icon zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
      <mask id="zintl-mark-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" />
        <g stroke="#fff" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" fill="none">
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

export default function LocaleSwitcher({ locale }: { locale: string }) {
  const segments = useSelectedLayoutSegments();
  const hrefFor = (l: string) => `/${l}/${segments.join("/")}`;

  return (
    <>
      {/* @zintl-ignore */}
      <section id="header">
        <div id="switcher" className="switcher">
          {locales.map((l) => (
            <Link
              key={l.id}
              href={hrefFor(l.id)}
              prefetch={false}
              data-lang={l.id}
              className={locale === l.id ? "active" : ""}
              aria-current={locale === l.id ? "true" : undefined}
            >
              {l.name}
            </Link>
          ))}
        </div>
        <div className="vertical-ticks"></div>
        <div className="icon-border">
          <ZintlMark />
        </div>
      </section>
      <div className="ticks"></div>
    </>
  );
}
