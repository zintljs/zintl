# `rsbuild-svelte-basic`

`create-rsbuild`'s **svelte-ts** starter, localized. Svelte 5 on Rspack.

```bash
pnpm dev      # rsbuild dev     — string edits apply, via a page reload (see below)
pnpm build    # rsbuild build
pnpm preview  # rsbuild preview
pnpm check    # svelte-check
```

Read it as "I ran `pnpm create rsbuild`, then added localization". The page, the
CSS and the mount point are the template's; what was added is the localization
layer — `src/lib/LocaleSwitcher.svelte`, the `?lang=` query parameter,
`await zintl(lang)` in `src/index.ts`, the catalogs under `zintl/`, and the
`index.html` template Zintl needs in order to localize `<title>` and
`<html dir>`.

## Why it exists

Until this app, the support statement said Svelte on Rspack was **untested here
rather than unsupported** — nothing was known to break, and nothing had watched
it either. It has now been watched, and the answer is the boring one: it works,
first try, with no change to Zintl. Extraction, chunk-aligned catalogs, ghost
mode, the HTML projection and all four locales behave exactly as they do on Vite.

That is worth stating precisely because the sister experiment came back the
other way. **Vue on Rspack does not work** — it builds green and ships
source-locale text, because `vue-loader` compiles an SFC through per-block child
requests that do not carry Zintl's transform. There is no Vue example here for
that reason. See
[L-051](../../docs/spec/proposals/027-leak-ledger.md) for the measurement and
what a fix has to decide.

## The one Svelte-specific thing

A sentence with an inline tag is stitched into a **single** key, so
`Edit <code>src/App.svelte</code> and save to test <code>HMR</code>` is one
translatable unit rather than three fragments. The consequence in Svelte is that
those `<code>` elements are rendered from the catalog through `{@html}` rather
than written in the template, and Svelte's scoped-CSS pass only sees markup it
can statically attribute to the component — so a plain `.content code` selector
is reported as `css_unused_selector` and pruned.

`src/App.svelte` therefore styles it as `.content :global(code)`. Nothing else in
the app needs to know that Zintl is there.

## And one thing that has nothing to do with Zintl

`rsbuild.config.mjs` pins `cssHash`. Svelte's default hashes the component's
**absolute filename** rather than its CSS, so the scoped class name changes when
the same source is compiled from a different directory — which made this
project's build-output snapshot depend on which test worker copied it. Hashing
the CSS makes the output a function of the source. Worth knowing if you ever
diff Svelte build output across machines; written up as
[L-052](../../docs/spec/proposals/027-leak-ledger.md).

## Dev edits reload rather than repaint

Deliberate, and the same trade `examples/rsbuild-vanilla-basic` makes. On Rspack
Zintl only emits `import.meta.webpackHot.accept()` when the framework declares
client reactivity, and today only React does — so a Svelte edit declines the
update, it bubbles, and the page reloads. The text is correct either way and
`<html dir>` survives.

That is a framework fact rather than a host one: the rule is "an app whose
components re-read the catalog repaints in place, one without them reloads", and
Svelte's runes re-read component state rather than the catalog. Wiring Svelte's
reactivity into the store is the same shape of work `clientReactivityImports` did
for React ([L-032](../../docs/spec/proposals/027-leak-ledger.md)), and it is not
done here.

## Status

Supported for single-page apps in build and dev, alongside
[`rsbuild-vanilla-basic`](../rsbuild-vanilla-basic) and
[`rsbuild-react-basic`](../rsbuild-react-basic). See
[proposal 030](../../docs/spec/proposals/030-rsbuild-what-remains.md) for what
that promise covers and what it deliberately excludes — SSR and `multiplex` are
not on this host.

Capabilities are claimed in `tests/manifests/rsbuild-svelte-basic.ts`, one at a
time, each after its contract passed here.
