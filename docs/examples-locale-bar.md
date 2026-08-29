# The locale bar

Every app under `examples/` renders the same locale bar: the same markup, the
same class names, the same behaviour, on every framework and both hosts. This
page is what "the same" means.

It exists so that a difference you notice between two examples is a difference in
**Zintl** rather than in their chrome. Before it, one concept — "switch the
locale" — had four DOM shapes across the suite, and seventeen test manifests each
carried a hand-written `switchLocale` that matched buttons by the script their
label happened to be written in.

The bar is an addition to each starter, not a replacement for it. Every example
is still `pnpm create vite` or `pnpm create rsbuild` output with a localization
layer on top; the bar is part of that layer, and the page below it is the
template's.

## Markup

```html
<section id="header">
  <div id="switcher" class="switcher">
    <!-- @zintl-ignore -->
    <button type="button" data-lang="en" class="active" aria-current="true">English</button>
    <button type="button" data-lang="ar">العربية</button>
    <button type="button" data-lang="es">Español</button>
    <button type="button" data-lang="zh">中文</button>
  </div>
  <div class="vertical-ticks"></div>
  <div class="icon-border">
    <svg class="icon zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
      <!-- … -->
    </svg>
  </div>
</section>
<div class="ticks"></div>
```

Locales are `en`, `ar`, `es`, `zh`, in that order, each written in its own
language. `ar` is not optional: it is what makes an RTL regression visible.

### `button` or `a`

The element follows the behaviour, and both are correct:

| Element    | When                                                            | Examples                                                                                     |
| :--------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| `<button>` | The app switches at runtime — `await zintl(lang)`, then repaint | `react-basic`, `preact-basic`, `solid-basic`, `lit-basic`, `vue-basic`, every `rsbuild-*`, … |
| `<a>`      | Locales are baked into separate documents under `/<locale>/`    | `vanilla-spa-i18n-baked`, `vanilla-mpa-baked-i18n`, `vinext-basic`                           |
| `<a>`      | The app switches at runtime **and** routes — see below          | `website`                                                                                    |

A baked switch really is a navigation, and deserves an element you can
middle-click. Everything else about the two is identical, which is why the CSS
selector is `.switcher > :is(button, a)` and the test helper keys on `data-lang`
rather than on a tag name.

## Behaviour

Runtime-switching apps put the locale in `?lang=`, call `await zintl(lang)`, and
repaint. Baked and multiplexed apps put it in the path and navigate. Either way
the bar itself holds no state — the active locale is read from the URL.

### The third case: a client router

An app with its own router can do both, and `website` does: the locale is a path
segment, the elements are `<a>` with real hrefs, and the click is intercepted so
the switch is `await zintl(lang)` and a repaint with nothing reloading. The href
means the link is shareable, indexable and middle-clickable; the interception
means following it costs no page load.

This is not the bar bending to suit one example. **The runtime already reads the
locale from the first path segment** — `syncLocale` in `store-client.ts` takes
`parts[0]`, adopts it if it names a locale, and is wired to `popstate` and to a
patched `pushState`. An app that prefixes its routes gets locale synchronisation
for free, and the `?lang=` convention above is the one that needs the extra
wiring.

Two details are load-bearing if you copy it:

- **Prefix every locale, the source language included.** With the default
  unprefixed, `syncLocale` falls through to its second source — `<html lang>` —
  which during a back navigation still holds the locale being navigated _away_
  from, so `/ar/guide/x` → back → `/guide/x` restores Arabic under an English
  URL.
- **Swap the catalog before the URL.** `await zintl(lang)` then `router.push`:
  pushing first navigates into a locale still in flight, and the push that
  follows is a no-op for `syncLocale` because the locale is already adopted.

## The mark

The Zintl mark is inlined rather than fetched. Inline is the only form that is
identical on both hosts: it needs no `public/` directory (the Rsbuild starters
have none), no sprite injection (the MPA examples inline theirs with `?raw`) and
no second request. It is drawn in `currentColor`, so it follows the bar into
light or dark without a filter — except in `website`, which fills it with the
brand gradient so that the header logo and the favicon are the same object.

It is `aria-hidden`, deliberately. Giving it an `aria-label` would put the brand
name into every catalog in every locale — `aria-label` is a live extraction
target — and a brand name is the one string that must not be translated.

## Nothing in the bar is extracted

Locale names live in a JS array, out of extraction's reach to begin with. Where
one reaches markup — the vanilla template literals, the React, Preact, Solid and Svelte
templates — the block carries `@zintl-ignore`. The Vue switchers need no marker
for exactly this reason, and say so in a comment.

The bar therefore contributes no catalog keys. That is a property worth keeping:
it means adding an example never adds translation work for the bar itself.

## Styling

One CSS block, appended to each app's own stylesheet under a
`── Zintl locale bar ──` banner. It is driven by two tokens with fallbacks:

```css
:root {
  --zintl-bar-border: var(--border, rgb(255 255 255 / 15%));
  --zintl-bar-text: var(--text, rgb(255 255 255 / 85%));
}
```

A starter that already defines `--border` and `--text` — the Vite templates do —
gets its own chrome for free. One that does not — the Rsbuild templates — falls
through to values that suit their dark gradient. `vinext-basic` names its palette
`--foreground`/`--background` and bridges the two in `globals.css`. No app forks
the block.

Logical properties throughout (`inset-inline`, `border-inline-start`), because
`<html dir>` is what Zintl projects per locale: the Arabic build flips the
document and nothing in the bar should need a second rule to follow it.

## Page chrome

Two things beyond the bar are the same in every example, because they are what a
reader sees before anything else.

**The favicon** is `zintl-favicon.svg`, in each app's `public/`. How it is linked
follows each host's own convention rather than being forced into one shape: the
Vite templates carry an explicit `<link rel="icon">`, because Vite injects
nothing; the Rsbuild templates carry none, because Rsbuild finds `public/favicon.svg`
and injects the link itself. Adding the tag on Rsbuild emits it twice.

**The title** follows one family:

```
[About — ]<Host> with <Framework> — Zintl <kind> example
```

— `Vite with React — Zintl example`, `Rsbuild with Vue — Zintl multi-page
example`, `About — Vite with TypeScript — Zintl shared-boundary example`. Titles
are extracted strings, so every one of them is translated into `ar`, `es` and
`zh`; the family is assembled from parts in each language, which is what keeps
thirty-odd titles consistent across four locales.

## What holds it in place

- `tests/contracts/locale-bar.contract.spec.ts` asserts the shape in the rendered
  page, on every project claiming `spa` and `locale-switch`. It checks the
  contract — the controls exist, they are the declared locales, exactly one is
  current, the mark is present — and not the styling, which is CSS and not
  something a test should pin.
- `clickLocaleBar(lab, locale)` in `@zintljs/testing` is how every manifest
  switches locale. If you find yourself writing a selector for a switcher, the
  bar has drifted.

## Adding an example

Copy the bar from the nearest example in the same dialect — `src/switcher.ts` for
vanilla, `src/components/LocaleSwitcher.tsx|vue`, `src/lib/LocaleSwitcher.svelte`
or `src/components/locale-bar.ts` for Lit — and append the CSS block to the new
app's stylesheet.

Three dialects have a wrinkle worth knowing before you copy:

- **Solid** — read `props.lang`, never destructure it. Solid compiles props into
  getters, so `const { lang } = props` is a one-time snapshot and the bar stops
  updating.
- **Lit** — the bar is a `<locale-bar>` custom element whose `createRenderRoot`
  returns `this`. Rendering into the light DOM is what lets the shared CSS reach
  it; a shadow root would make this the one bar that could not look like the
  others.
- **Preact** — identical to React's, `dangerouslySetInnerHTML` included, except
  that the template writes `class` rather than `className`. Zintl reads both.

Then give the manifest `switchLocale: (lab, locale) => clickLocaleBar(lab, locale)`
and let the contract tell you whether you got it right.
