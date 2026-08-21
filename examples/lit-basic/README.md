# `lit-basic`

`create-vite`'s **lit-ts** starter, localized. The example that needed a new
extractor capability rather than only a facet.

> The locale switcher is the shared **Zintl locale bar** — the same markup,
> class names and behaviour every example renders, documented in
> [`docs/examples-locale-bar.md`](../../docs/examples-locale-bar.md). It is part of
> the localization layer, not of the starter.

```bash
pnpm dev      # vp dev
pnpm build    # tsc && vp build
pnpm preview  # vp preview
```

**`src/my-element.ts` is the template's own file** — shadow DOM, the
`static styles = css` block, the `<slot>`, all of it. Diffed against a fresh
`create-vite --template lit-ts`, it differs in exactly two ways: this repo's
formatter has been run over it (quotes, semicolons, line wrapping), and one
`<!-- @zintl-ignore -->` line marks the social list, which `examples/react-basic`
marks too because brand names are not translatable. No logic, no structure and no
markup changed.

That is the strongest claim this example makes: Zintl reads the real starter, and
the component did not have to move an inch to accommodate it.

The localization layer is three additions beside it: `src/main.ts` (which the
template does not have), `src/components/locale-bar.ts`, and two lines in
`index.html`.

## What Lit needed

Lit has no file format of its own. A component is an ordinary module and its
markup lives in an `` html`…` `` tagged template literal, which fits neither
existing extraction seam — an `sfcRules` entry for `.ts` would either hijack every
module in the project or leave the JavaScript around the template unextracted,
taking `zintl()` anchors with it.

So the extractor gained a `` tag:`<name>` `` target: _the contents of a template
literal tagged with this identifier are markup_. That is a fact about syntax, not
about Lit — htm and uhtml get it from the same declaration — and the facet names
`html`, which is where framework knowledge belongs. Note that `static styles =
css\`…\``is left alone, because`css` is not a declared tag.

## Two things this example does that the others do not

**The elements are defined after the catalog.** `@customElement` calls
`customElements.define` at module scope, so importing the component upgrades it
immediately — before `zintl()` has resolved, which paints the source locale
first. `src/main.ts` therefore imports both elements **dynamically, after
awaiting the anchor**. That is the Lit-shaped answer to the problem every other
example solves by deferring `render()`.

**The app repaints itself on a locale change.** A Lit element redraws when a
reactive property changes or when something calls `requestUpdate()` on that
instance, and a module-level store can reach neither. `litRuntimeFacet` leaves
`repaintsOnCatalogUpdate` undeclared rather than claiming a repaint it cannot
deliver, and the listener in `src/main.ts` is what an application writes instead.
Closing that properly needs a registry of connected elements — which is what
`@lit/localize` maintains through a mixin, and a mixin is application code.

The bar renders into the **light** DOM (`createRenderRoot` returns `this`) while
`my-element` keeps its shadow root. That contrast is deliberate: the bar's
styling comes from the page stylesheet like every other example's, and a shadow
root would seal it off.
