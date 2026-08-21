# `lit-basic`

`create-vite`'s **lit-ts** starter, localized. The example that needed a new
extractor capability rather than only a facet.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # vp dev
pnpm build    # tsc -b && vp build
pnpm preview  # vp preview
```

## Why Lit needed `tag:`

Lit has no file format. A component is an ordinary `.ts` module and its markup
lives in `` html`…` `` — a tagged template literal inside a method. Neither
existing seam fits: an `sfcRules` entry splits a file by regex, so declaring one
for `.ts` would either hijack every module in the project or leave the code
_around_ the template unextracted, taking the `zintl()` anchor with it.

So the extractor gained a `` tag:`<name>` `` target: "the contents of a template
literal tagged with this identifier are markup". That is a fact about syntax
rather than about Lit — htm and uhtml get it from the same declaration — and it
routes into the same stitcher that reads `el.innerHTML = ` in a vanilla app. A
sentence broken across `<code>` stays one key; `${this.name}` normalizes to
`{name}`.

## Two things Lit does that nothing else did

- **Rich text needs an import.** React's `dangerouslySetInnerHTML` and Svelte's
  `{@html}` are syntax; Lit's `unsafeHTML` is a directive you import, because Lit
  escapes interpolated strings on purpose. That is what `codegenImports` and
  `wrapTemplateFragment` exist for, and the facet pays for the directive only on
  sinks that actually carry markup.
- **The light DOM, deliberately.** Both elements return `this` from
  `createRenderRoot`, so they share the page's stylesheet. Shadow styling would
  work fine for the app — it would just make this the one example whose chrome
  could not be the shared one.

## Known limits, stated rather than hidden

- **Attributes inside the template are not extracted.** `<button title="Close">`
  is invisible to the stitcher, which reads text and tags. This is not a Lit
  limitation — a vanilla `el.innerHTML = ` template behaves identically — so Lit
  has exactly vanilla's coverage. The fix belongs in the stitcher, for both.
- **A delivered catalog does not repaint a live element.** Lit redraws on a
  reactive property change or an explicit `requestUpdate()`, and a module-level
  store can reach neither without a registry of connected components — which is
  what `@lit/localize` maintains through a mixin, and a mixin is application
  code. `litRuntimeFacet` leaves `repaintsOnCatalogUpdate` undeclared rather than
  claiming a repaint it cannot deliver, so the host reloads instead. Switching
  locale from the bar works, because this app listens for it and sets state.

## What is not vendored

The Lit logo — see [`../preact-basic/README.md`](../preact-basic/README.md).
