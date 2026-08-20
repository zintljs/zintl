# `rsbuild-vanilla-basic`

`create-rsbuild`'s **vanilla-ts** starter, localized. Four locales, a locale
switcher, a counter, and a localized `.txt` asset — built and served by
[Rsbuild](https://rsbuild.dev) instead of Vite.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # rsbuild dev     — string edits apply, via a page reload (see below)
pnpm build    # tsc && rsbuild build
pnpm preview  # rsbuild preview
```

Read it as "I ran `pnpm create rsbuild`, then added localization". The page, the
CSS and the `#root` mount point are the template's; everything under _What was
added_ is the localization layer, and it is the same layer every Vite example
uses. It also deliberately mirrors
[`examples/vanilla-spa-basic`](../vanilla-spa-basic) at the Zintl level, so any
difference in output is attributable to the **host** rather than to the app.

> Named `rsbuild-spa` until the `rsbuild-<framework>-<pattern>` convention took
> hold. Proposals 026–030 and both leak ledgers still use the old name on
> purpose: they record what was measured when.

## What was added to the template

Three things, and nothing else:

- **The localization layer** — `src/switcher.ts`, the `?lang=` query parameter,
  `await zintl(lang)` in `src/index.ts`, and the catalogs under `src/i18n/`.
- **`index.html` + `html.template`.** The template lets Rsbuild generate its own
  document, and with no source template there is nothing for Zintl's HTML
  projection to write into — no localized `<title>`, no per-locale `<html dir>`.
  Supplying a template _is_ part of adding localization.
- **`rsbuild.config.mjs`, not the template's `.ts`.** The facet-composition
  golden identifies the host by that filename, and a `.ts` config would want a
  `tsconfig.node.json` split the template does not ship.

## What this demonstrates

**Nothing about the app is Rsbuild-specific.** The source is plain string
literals, `zintl(locale)` is the trust anchor, and the catalogs under `src/i18n/`
have the same shape as every Vite example's. Only `rsbuild.config.mjs` differs,
and only in importing `zintljs/rsbuild` rather than `zintljs/vite`.

The claim that survived the port intact is the central one: **catalogs stay
aligned to the bundler's own code splitting.** The build emits one async chunk
per non-source locale, each carrying only its own catalog, with no
Rspack-specific chunking code anywhere in Zintl — the compiler emits one virtual
module per chunk behind a dynamic import and lets the host's splitter place it.
Ghost mode holds too: there is no `en` chunk, because the source locale is never
written to disk.

**The document follows the locale as well.** Switching to Arabic sets
`<html lang="ar" dir="rtl">` and swaps `<title>` — through
`src/i18n/index.html.translations.json`, the same HTML catalog every Vite
example uses. Two things had to exist for that: Rsbuild's `api.modifyHTML`,
which is the host-neutral counterpart of Vite's `transformIndexHtml`; and a way
to tell Zintl which script this document loads, since an Rsbuild template names
none — the entry is injected from `source.entry` at build time, so the
association lives in `rsbuild.config.mjs` where only the host can see it.

## What is not supported

Stated plainly, because an example that looks complete while quietly doing less
is worse than one with a known gap.

| Gap             | Why                                                                                                                                                     |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`multiplex`** | Per-locale HTML fan-out is Vite-only and **not planned** here. Combining it with this host fails the build immediately with a clear Zintl error (L-022) |
| **Preloading**  | The projection injects no `<link rel="modulepreload">` here. Catalogs still load, one network round-trip later than they would on Vite                  |
| **SSR**         | Unbuilt and unexamined                                                                                                                                  |

**Dev-time string edits work as of [proposal 029](../../docs/spec/proposals/029-rsbuild-hmr-facet-seam.md)
— and in this app they arrive through a full page reload, which is deliberate.**
`pnpm dev` picks up an edit on the source locale and on lazily-loaded ones alike;
measured here, the text is correct either way and `<html dir>` survives.

The reload is the honest half of the story and this app is the reason. Zintl's
hot-update path replaces a catalog and expects _something_ to repaint. A
framework app has that — a component re-reads the catalog and renders again, and
[`examples/rsbuild-react-basic`](../rsbuild-react-basic) does apply edits in
place with no reload. A vanilla app's only repaint is re-running the entry, and
on Rspack a re-executed entry reads its imports from the module cache: it can
re-seed itself from a manager that has not been replaced yet and render `""` for
every key the incoming catalog was about to supply. So the entry **declines** the
update, it bubbles, and the page reloads — slower than a hot update and correct,
which is the trade Vite already makes for frameworks whose mount is not
replayable ([L-035](../../docs/spec/proposals/027-leak-ledger.md)).

Two things made the underlying machinery possible, and the second is the
interesting one:

- Rspack supplies both guarantees Zintl's delivery bus requires, from its own
  machinery rather than anything Zintl invents — `Watching.startTime` is the
  monotonic per-event sequence, `compiler.inputFileSystem` is the read scoped to
  that event.
- Rspack rebuilds whatever **its own dependency graph** says is stale, and asks
  Zintl nothing. So the generated catalogs are not invalidated by hand here; they
  _declare what they are derived from_, and Rspack rebuilds them in the same
  compilation as the edit. Vite works the opposite way round — it asks for a
  module list — which is why the two hosts share every decision and none of the
  application of it.

## Plurals live in the catalog, not in the source

`src/counter.ts` writes the plain thing:

```ts
element.innerHTML = `Count is ${counter}`;
```

English needs one form there. Arabic needs several, and it gets them in
`src/i18n/translations.json` — where the person who knows the language is
working, rather than threaded through the component:

```json
"Count is {counter}": {
  "ar": "{counter, plural, zero {لم يبدأ العد بعد} one {العدد واحد} two {العدد اثنان} few {العدد {counter}} many {العدد {counter}} other {العدد {counter}}}",
  "es": "{counter, plural, =0 {Aún no has contado} one {La cuenta es uno} other {La cuenta es #}}",
  "zh": "{counter, plural, =0 {还没有开始计数} other {计数为 {counter}}}"
}
```

Between them those cover named CLDR categories, `=0` exact matches, `#`
substitution, and interpolation inside a branch. Clicking the counter in Arabic
walks `zero → one → two → few`, which are distinctions the English source never
had to anticipate.

**None of that syntax reaches the browser.** The compiler bakes it to JavaScript
at build time — measured here, the emitted Arabic chunk is:

```js
"3aaf6932": (e) => {
  let s, { counter: l } = e;
  return `${
    "zero" === (s = new Intl.PluralRules("ar").select(e.counter))
      ? "لم يبدأ العد بعد"
      : "one" === s ? "العدد واحد"
      : "two" === s ? "العدد اثنان"
      : `العدد ${e.counter}`
  }`;
};
```

A native `Intl.PluralRules` call and a conditional chain — with the identical
`few`/`many`/`other` branches folded together, and no ICU parser anywhere in the
bundle. This is the only Rspack example that exercises grammar compilation;
until it did, ICU on this host was an inference from the fact that baking happens
in the compiler.

## The localized asset

`src/about.txt` and its copies under `src/i18n/src/` are not decoration. Rspack
types modules by **file extension**, decided before any plugin speaks, where
Rollup and Vite type them by whoever loaded the module. So a `.txt` that Zintl
loaded as JavaScript was classified as an asset and base64-encoded into a
`data:` URI — the catalog shipped a URI where the translated text belonged, with
a green build and green contracts.

Fixed by giving generated modules an extension-free virtual identity, and the
contract suite now asserts the rendered Arabic in a real browser. Recorded as
**L-009** in the [026 leak ledger](../../docs/spec/proposals/026-leak-ledger.md).

## Status

Promoted from a test fixture to an example by
[proposal 027](../../docs/spec/proposals/027-completing-the-rsbuild-target.md),
and from an example to a supported target by
[proposal 029](../../docs/spec/proposals/029-rsbuild-hmr-facet-seam.md), which
built the HMR facet seam that [028
§6](../../docs/spec/proposals/028-rsbuild-support-status.md) named as the
structural blocker.

This app claims eleven of the contract layer's capabilities, including `hmr` and
`hmr-stress` — every one added only after its contract passed against this host,
which is why the suite carries no skipped tests.

Two are still unclaimed and neither is a gap in the gaps table above, because
neither is a defect in this integration. `memory` needs `memory-leak`'s twenty
sequential edits to fit inside 45s, and every edit here costs two compilations —
Zintl's own catalog write is, necessarily, a declared dependency of the generated
modules. `chaos` needs `chaos-boundary` to stop assuming the renamed file and the
heading file are the same one, which they cannot be when the entry is named in
`rsbuild.config.mjs`. Both are written up in
`tests/manifests/rsbuild-vanilla-basic.ts`.
