---
"@zintljs/testing": patch
---

Give every example the same locale bar, carrying the Zintl mark, and add a contract that keeps it
that way.

**What was wrong.** One concept — "switch the locale" — had four DOM shapes across twenty-five
example apps: a header band on the Vite ones, a `position: fixed` pill row with its CSS copied
verbatim into each component's `<style>` block on the eight Rsbuild ones, `.locale-switcher >
.lang-btn` on `vanilla-spa`, and Tailwind utilities on `vinext-basic`. `website` offered three
locales where everything else offered four, and carried a `.lang-switcher` rule nothing referenced.
Nothing failed, because nothing was checking.

The cost was not cosmetic. Seventeen manifests each carried the same hand-written `switchLocale`,
matching buttons by the script their label happened to be written in —
`lab.page.click("button:has-text('العربية')")` — because there was no shared contract about what a
switcher _is_.

**What changed.** Every example now renders one bar: the same markup, class names, behaviour and
brand mark, in five dialects (vanilla, React, Vue, Svelte, Next/RSC). The element follows the
behaviour rather than the framework — a `<button>` where the app switches at runtime, an `<a>` where
locales are baked into separate documents and the switch really is a navigation — and the styling is
one CSS block driven by two tokens with fallbacks, so a starter that defines `--border`/`--text`
keeps its own chrome and one that does not falls through to values suiting its dark gradient. No app
forks it. It is documented in `docs/examples-locale-bar.md`.

The bar contributes no catalog keys, which is a property worth keeping: adding an example never adds
translation work for the bar itself.

**Page chrome** followed: the Zintl favicon in all twenty-five apps, linked the way each host wants
it (explicitly on Vite, which injects nothing; not at all on Rsbuild, which finds `public/favicon.svg`
and would otherwise emit the tag twice), and one title family —
`[About — ]<Host> with <Framework> — Zintl <kind> example` — translated into `ar`, `es` and `zh` for
every app, replacing titles that ranged from `react-basic` to `Rsbuild with React - Zintl example`
and six that shipped an empty string.

**For the harness**, `@zintljs/testing` gains `clickLocaleBar(lab, locale)`, keyed on `data-lang`
rather than on a visible label, and every manifest's `switchLocale` collapses to one call. The new
`locale-bar` contract asserts the shape in the rendered page on all twelve projects claiming `spa`
and `locale-switch` — the controls exist, they are the declared locales in order, exactly one is
current, the mark is present and drawn in `currentColor`, and switching moves the mark of currency.
It checks the contract and not the styling, because CSS is not what a test should pin.
