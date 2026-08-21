---
"@zintljs/extractor": minor
"@zintljs/compiler": patch
---

Extract translatable attributes from markup written inside a JavaScript template.

An `alt`, `title`, `placeholder` or `aria-label` was extracted from an HTML document, from a Vue or
Svelte SFC template, and from JSX — and **silently dropped** from the same markup written inside a
JS template literal, which is how every vanilla app and every Lit component writes it. Nothing
failed; the string simply never reached a catalog, so no translator ever saw it.

It was live in one template localized six ways. `react-basic`, `preact-basic`, `solid-basic` and
`vue-basic` all had `"Vite logo"` in their catalogs. `lit-basic` and the nine vanilla apps did not,
from identical markup.

**The cause** was that attribute extraction existed in exactly one place: a loop inside `extractHtml`,
which runs only for `.html` documents and SFC template blocks. The JavaScript path —
`findLiteralsInExpression` — called `stitchHTML` for text nodes and never looked at attributes.

So the loop became `scanTranslatableAttributes`, in its own module because `context.ts` cannot import
`html.ts` without closing a cycle, and both literal branches now call it. What made it shareable is
that each caller already had the thing that differs: a function mapping an index in the markup to a
source offset. An HTML document adds a constant; a template literal walks its quasis — and _refuses_,
by throwing, for a range crossing an interpolation. The scanner reads that refusal as "skip", which is
what keeps `src=${logo}` from being mistaken for a translatable string.

**No new capability was needed**, because of one choice: inside a JS template the sink covers the
attribute's **value**, not the whole attribute, and carries `isFragment`. The existing fragment path
then drops a `${…}` between quotes that are already there —

```js
el.innerHTML = `<img alt="${_t("Vite logo", …)}" />`;   // plain JS
html`<img alt="${_t("Vite logo", …)}" />`               // a Lit quoted binding
```

— which is valid in both hosts at once. `wrapHtmlAttribute` is correspondingly gated on `!isFragment`:
it rewrites the attribute _and its name_, which is right for the whole-attribute form and would emit
the name twice for a fragment.

Attribute values containing an interpolation (`title="Hello ${name}"`) are skipped rather than
mangled. That matches the paths that already worked — `.html` and SFC extraction both pass
`variables: []` — so it stays one limitation shared by every path instead of becoming a per-path quirk.

Eleven example apps now extract strings they were losing; the `.html` and SFC transform snapshots do
not move at all, which is what says the lifted loop still behaves as it did on the path it came from.
