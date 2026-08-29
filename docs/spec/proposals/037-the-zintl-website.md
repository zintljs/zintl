# Proposal 037: The Zintl Website

**Status**: IN PROGRESS — §9.1 and §9.2 are built. §11 records what building it corrected in this document
and the two compiler defects it found.
**Date**: 2026-08-29
**Kind**: Design and plan. Every claim about current behaviour below was read from the code or the
docs cited; every claim about the _site_ is intent.
**Depends on**: the assets preset (`packages/compiler/src/facet/presets/assets.ts`), the Vue facet,
the client-SPA facet, and `examples/vue-spa` as the working precedent for lazy routes.
**Replaces**: the current `examples/website` — a vanilla-TS scratch playground last touched in
`9886132`, which owns the branding assets the root README links to.

## 0. The thesis

Zintl's pitch is hard to believe from a README, because the README has to _assert_ the things the
compiler does. A website can **show** them: switch the locale and watch the page change with no
reload, open the network panel and watch a single page's catalog arrive, flip to Arabic and watch
the whole layout mirror.

So the site is not a brochure about Zintl. It is a Zintl app whose subject happens to be Zintl, and
every claim it makes is one the reader can verify in the page they are reading. The strongest
section on the landing page is the one that says _this page you are on right now cost you 2.4 KB of
Arabic, and here is the request_.

The second constraint is the one that shapes the docs half: **the reader should feel relaxed.** Vite's
docs are the reference. That means a small number of short pages, a wide quiet reading column,
generous line height, and no page that needs a scrollbar the size of a thumbnail. `configuration.md`
is 543 lines today. Nothing on this site will be.

## 1. Decisions

Four decisions were taken before this document, and they set everything downstream.

| Decision     | Taken                                                         | Why                                                                                                                                                                           |
| :----------- | :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stack**    | Vue 3 + `vue-router`, single-page app                         | Closest to the VitePress feel being referenced. Both are already in the catalog, `@vitejs/plugin-vue` with them, and `examples/vue-spa` is a working lazy-route precedent.    |
| **Location** | Rebuild `examples/website` in place                           | Keeps the public site under the same gates as everything else: it builds in `vpr build:examples`, it gets linted and knip'd. The real site cannot drift from a working Zintl. |
| **Content**  | The site owns its own trimmed `.md` pages                     | The repo's `docs/` are written for GitHub readers and are long. "Relaxed" is an authoring decision before it is a layout one.                                                 |
| **i18n**     | Full — chrome, landing and docs prose, in `en` `ar` `es` `zh` | Arabic is what makes the RTL flip real, and a docs site that is only half translated is a demo of the thing Zintl refuses to do.                                              |

### 1.1 One decision this document takes on its own: the locale lives in the path

`docs/examples-locale-bar.md` says runtime-switching apps put the locale in `?lang=` and use
`<button>`; apps that navigate use `<a>` and a path. This site is the case that spec did not
anticipate: it switches at runtime **and** navigates, because it is a client-side router.

It uses `<a>` elements and a path prefix — `/en/guide/getting-started`, `/ar/guide/getting-started` —
intercepted by the router, so the switch is `await zintl(lang)` and a repaint with no reload, while
the URL stays shareable, middle-clickable and indexable.

**Every locale is prefixed, English included**, which this document originally had wrong. The
runtime already reads the locale from the _first path segment_: `syncLocale` in `store-client.ts`
takes `parts[0]`, adopts it if it names a locale, and is wired to `popstate` and to a patched
`pushState`. So the path-based scheme is not a deviation the site invents — it is the shape the
client facet was built for. An unprefixed default would leave that lookup falling through to its
second source, `<html lang>`, which during a back navigation still holds the locale being navigated
_away from_: `/ar/guide/x` → back → `/guide/x` would restore Arabic under an English URL. Prefixing
all four makes the runtime's own rule sufficient instead of something to work around, and that is
worth more than the prettier bare URL `vite.dev` gets to use.

Nothing in the bar's actual contract breaks: the markup, the class names, the `data-lang`
attributes and the `.switcher > :is(button, a)` selector are all unchanged, and that selector
already admits `<a>`. What needs amending is one sentence of prose in the bar doc, and §9.8 does it.

## 2. Information architecture

```
/{en,ar,es,zh}/                    landing
/{en,ar,es,zh}/guide/…             5 pages
/{en,ar,es,zh}/concepts/…          2 pages
/{en,ar,es,zh}/reference/…         4 pages
/                                  redirects to /en/
```

Eleven docs pages across **three** sections. That is the whole of it, and the number is a budget
rather than a starting point — Vite has roughly forty, and being smaller than the tool we are
imitating is the point. Stability sits under Reference rather than in a Meta section of its own:
one page is not a section, and `/meta/stability` is an ugly URL for a page people are sent to.

| Section       | Page                  | What it is                                                                 | Source                           |
| :------------ | :-------------------- | :------------------------------------------------------------------------- | :------------------------------- |
| **Guide**     | What is Zintl         | The pitch and the mental model, in the order a newcomer needs them         | README + `docs/README.md`        |
|               | Getting started       | Install, plugin, anchor, run. Nothing else.                                | README quick start               |
|               | Translating           | Where catalogs land, filling them, XLIFF in and out, why integrity is loud | `configuration.md` §upkeep       |
|               | Locales and switching | Variable vs literal, baked builds, per-locale fan-out                      | `architecture.md` §what you pass |
|               | Plurals and grammar   | One source string, correct grammar everywhere; ICU compiled away           | `icu.md`                         |
| **Concepts**  | Boundaries and chunks | Trust anchors, the graph, why translation is a bundling problem            | `architecture.md`                |
|               | Glossary              | The vocabulary, alphabetical                                               | `glossary.md`                    |
| **Reference** | Configuration         | Every option, as tables                                                    | `configuration.md`               |
|               | Comment directives    | `@zintl-ignore`, `@zintl-note`, `@zintl-pass`, `@zintl-target`             | `directives.md`                  |
|               | Integrations          | Vite, Rsbuild, vinext — what is supported and what is not                  | README §where it runs            |
| **Meta**      | Stability             | What is settled, what is moving, how to remove Zintl                       | `stability.md`                   |

The repo's `docs/` stay where they are for now and keep serving GitHub readers. Collapsing the two
into one source is a later decision, and a bigger one; it is out of scope here (§10).

## 3. The landing page

Nine sections. Each one is a claim the README makes, rebuilt as something the reader can operate.

1. **Hero.** Headline, subhead, `npm i -D zintljs` with a copy button, two calls to action. The
   locale bar sits in the header above it, and switching from here is the first thing most visitors
   will do — so this section has to be the one that repaints most convincingly, RTL included.
2. **The whole API.** The README's five-line sample, verbatim. `await zintl(locale)` and a plain
   `<h1>`. The caption is the README's: no keys, no wrappers, no dictionary.
3. **Before and after.** `t("welcome.title")` beside `<h1>Welcome back!</h1>`, as a two-pane diff.
   Static, and the shortest section on the page.
4. **Translation is a bundling problem.** The interactive one: a small boundary graph — files,
   anchors, boundaries, chunks. Hovering a route lights the catalog it pulls and dims the rest.
   Proposal 020 wanted this visualization for debugging; this is the same picture, for persuasion.
5. **Variable or literal.** A toggle between `zintl(locale)` and `zintl("fr")`, showing
   `architecture.md`'s table as build output: chunks emitted, catalog present, and the third row that
   does the work — _source-locale strings in bundle: absent_.
6. **Grammar compiles away.** An ICU source string beside the JavaScript conditional it becomes, and
   a live counter driving it. Arabic has six plural forms; this is where that stops being trivia.
7. **Ghost mode.** A file tree with the source-locale catalog struck out. One sentence: it was never
   written.
8. **Where it runs.** The README's host/framework matrix as a grid, with the unsupported list kept —
   the honesty is part of the pitch.
9. **This page is the demo.** The meta panel: which boundary served this page, how many bytes of the
   active locale it loaded, and the request that carried them. Read live from the runtime, not
   hardcoded.

## 4. What each Zintl feature gets to show

The site is also a coverage exercise. This table is how we check the landing page is arguing the
right things, and it is the acceptance criterion for §9.5 and §9.6.

| Feature                     | Where it shows                                                         |
| :-------------------------- | :--------------------------------------------------------------------- |
| No `t()` wrappers           | Every source file on the site; §3.2 and §3.3 make it explicit          |
| Runtime locale switch       | The bar, on every page, with no reload                                 |
| RTL                         | Arabic flips the entire layout — nav, sidebar, TOC, code gutters       |
| Chunk-aligned catalogs      | §3.4, and the per-page readout in the docs footer                      |
| Lazy boundaries             | One catalog per docs page, arriving on navigation                      |
| Localized assets (`.md`)    | Every docs body — the first real `.md` asset consumer in the repo (§5) |
| ICU compiled to JS          | §3.6                                                                   |
| Ghost mode                  | §3.7                                                                   |
| Literal vs variable anchors | §3.5                                                                   |
| Intelligent stitching       | Any prose sentence in the chrome that wraps a `<code>` or a link       |
| `verifyIntegrity`           | The build gate itself — the site cannot ship a missing translation     |

## 5. Technical design

### 5.1 Anchors and boundaries

One root anchor in `src/main.ts`, taking a **variable**: `await zintl(localeFromPath)`. Every locale
ships, switchable at runtime, catalog chunks emitted. A literal here would bake one language and
break the switcher — which is exactly the mistake `architecture.md` warns is quiet rather than loud,
and it is worth a comment in the source saying so.

Every docs page is a lazily imported route component, so each page is its own chunk and its
catalog splits along with it. This is not a performance optimization we are reaching for; it is the
demonstration. The docs footer reads the result back to the reader.

### 5.2 The markdown pipeline, and the one real risk

Docs bodies are `.md` files under `src/content/`, which `assetsTarget`'s default `["md", "txt"]`
already targets. Zintl writes an empty `zintl/src/content/<page>.<locale>.md` per locale for us to
author — it never copies the English across, by design (proposal 035). Pages import their body as
`?raw`, which the configuration doc describes as inlined into the catalog and re-pointed at runtime
without a reload. `examples/website` already proves that path with `about.txt`.

**Nothing in the repo consumes `.md` as an asset yet.** This site would be the first, and that is
worth stating plainly as the one integration risk in this plan rather than discovering it in §9.4.
Frontmatter is not a complication — 035 deleted the merge strategies, so `.md` is handled exactly
like `.txt`. Step §9.2 puts a single page through the whole path end to end before any content is
written, so if the assumption is wrong we learn it on page one and not on page eleven.

Rendering is a hand-written subset renderer plus a small regex highlighter, in `src/lib/`, no new
dependency. The subset is what we author and nothing more: headings, paragraphs, lists, tables,
fenced code, blockquote callouts, links, inline code, emphasis. Roughly 300 lines for both. A
markdown library and a syntax highlighter would together outweigh the site's entire runtime, on a
site whose second principle is that nothing ships that isn't used.

### 5.3 RTL, theme, and type

RTL is CSS logical properties throughout — `margin-inline-start`, not `margin-left` — with `dir` set
from the active locale on `<html>`. There is no RTL stylesheet, because a second stylesheet is a
second thing to forget. Theme is a light/dark token set on `:root`, seeded from
`prefers-color-scheme`, overridable by a toggle, persisted. The existing playground's palette
(`--accent: #aa3bff`) and the README badge colours (`#F4795E`, `#1B1420`, `#E8309C`, `#B44BE0`) are
the starting point for the tokens.

### 5.4 Search

Client-side, over a build-time index of the active locale's headings and first paragraphs, loaded on
first keypress rather than on page load. It is a docs-site table stake, and it is the last thing in
§9.7 because the site is usable without it.

## 6. What "relaxed" means concretely

Stated as numbers, so it can be checked rather than felt:

- Reading column caps at ~72 characters; the page does not use the full width of a desktop display.
- Body type at 17–18px, line height 1.7, generous space above headings and little below them.
- No page longer than roughly 1,200 words. A page that outgrows that gets split, not scrolled.
- The sidebar shows the current section expanded and the rest collapsed.
- Motion is short and only on interaction, and every animation is off under `prefers-reduced-motion`.
- Code blocks are the only high-contrast element on a page.

## 7. Risks

| Risk                                                                           | Handling                                                                                                |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| `.md` as a localized asset is unproven in this repo                            | §9.2 drives one page through the full path before any content exists                                    |
| 11 pages × 3 locales is real authoring work                                    | Pages are wired in only once their three artifacts are filled, so the build is never red (§8)           |
| The site grows the `vpr build:examples` gate                                   | Measure it in §9.8; if it is material, that is an argument for a separate workspace, made with a number |
| A hand-written markdown renderer is a maintenance surface                      | Keep the subset small and the content inside it; the renderer is replaceable behind one function        |
| `examples/website` currently owns the branding assets the root README links to | `public/` is preserved as-is through the rebuild                                                        |

## 8. How localization stays green

`verifyIntegrity` has no partial mode and should not grow one. An empty `.md` artifact fails the
build, which is correct and is the behaviour the site exists to advertise.

So content lands **page-complete**: a page's route is registered in the same change that fills its
`ar`, `es` and `zh` artifacts. Until then the page's `.md` lives outside `assetsTarget`'s reach in a
staging directory. The build is green at every commit, and the site is never showing a reader a
language it does not have.

## 9. The work

Each step builds, lints and is worth committing on its own.

**9.1 — Foundation.** Replace the playground with a Vue + `vue-router` package, preserving `public/`.
Vite config with the four locales and `outputDir: "./zintl"`, matching the other examples. Design
tokens, app shell, header with the locale bar and theme toggle, footer, path-based locale routing
with the router intercept, landing and docs routes stubbed. _Done when_ `vp dev` switches all four
locales with no reload and Arabic mirrors the shell.

**9.2 — The docs page, end to end.** One page — What is Zintl — through the entire path: `.md`
source, Zintl-authored artifacts in four locales, `?raw` import, renderer, highlighter. Plus the
docs layout: sidebar, on-this-page TOC, prev/next, edit-on-GitHub, 404. _Done when_ the page reads
correctly in all four locales and its catalog arrives as its own chunk on navigation. **This is the
step that validates §5.2; everything after it assumes the answer.**

**9.3 — Docs shell polish.** Sidebar grouping and collapse, active-section tracking, scroll-spy TOC,
breadcrumbs, keyboard navigation, the per-page catalog readout in the footer.

**9.4 — The remaining ten pages, English.** Authored short, against §6's budget. Routes stay
unregistered until §9.6 fills their artifacts.

**9.5 — Landing page, static.** Sections 1, 2, 3, 7, 8 and the footer. The page is complete and
persuasive without any of the interactive work.

**9.6 — Landing page, interactive.** Sections 4, 5, 6 and 9 — the boundary graph, the variable/literal
toggle, the ICU counter, and the live meta panel.

**9.7 — Localization pass.** Fill the chrome and landing catalogs for `ar`, `es`, `zh`; author the
thirty-three `.md` artifacts; register each page as it completes. RTL audit across every page. _Done
when_ `verifyIntegrity` passes on a production build with no page excluded.

**9.8 — Polish, gates, and the doc amendment.** Search (§5.4), a11y pass, meta and OG tags, reduced
motion, Lighthouse. Add the package to `knip.config.ts`. Amend `docs/examples-locale-bar.md` for
§1.1. Measure the added gate time. `vpr verify`, then `vpr ci`. Changeset.

**9.9 — Deploy.** Open, and it needs a decision that is not this document's to take: GitHub Pages
from `ci.yml` is the default guess for an OSS project, and the domain is unknown here.

## 10. Not in scope

- **Merging the repo's `docs/` into the site.** The right end state is one set of prose and a `docs/`
  that points at it. It churns every link in the README and the specs, and it should be its own
  change once the site exists and has proven it can hold the content.
- **A contract test for the site.** `examples/website` is in no manifest today and this does not add
  one. If the site is worth contract coverage it is for the `.md`-asset path, and that deserves a
  fixture rather than an eleven-page app.
- **SSR or per-locale static fan-out.** Both would suit a docs site and both are real Zintl features.
  The SPA is what shows the runtime switch, which is the more persuasive of the two. A `multiplex`
  build of the same content is a good follow-up and a good second demo.
- **Versioned docs.** Zintl is in alpha with one version.

## 11. What building §9.1 changed

Three things this document had wrong or unstated, and two defects in the compiler it documents.

### 11.1 Corrections to this document

- **§1.1** claimed path-based locales were a deviation from the locale-bar spec. They are the shape
  `store-client.ts` already reads. English is prefixed too, and the reason is in §1.1 now.
- **§2** listed four sections and a `/stability` page hanging off the root. Three sections, with
  Stability under Reference.
- **§5.1** said one anchor in `main.ts` and left it there. The switcher re-anchors as well, before it
  navigates, so the catalog is in hand before the URL moves — the same order every framework example
  uses, and the reason the runtime's own `syncLocale` finds nothing to do when the push lands.

### 11.2 Two defects, both found by writing prose in markup

Neither was reachable from the existing examples, and the reason is the same in both cases: an
example app is a few one-line labels and a component tree, and a documentation site is paragraphs and
a data module. The suite was not wrong to miss them; it had nothing shaped like this in it.

**A paragraph wrapped across source lines became a key with a newline in it.** Fixed in the
extractor's HTML/SFC stitcher, which now collapses whitespace the way HTML does, `<pre>` and its
three neighbours excepted. It was two bugs wearing one coat: a key tied to the author's indentation
(so `vp fmt` could orphan a translation) and a raw newline inside a quoted JavaScript literal (so a
Vue SFC failed to compile at all). Three examples had their keys cleaned and every translation
survived reconciliation. Changeset: `a-wrapped-paragraph-is-one-sentence`.

**Strings reached through an exported function never arrived in any catalog chunk.** Fixed in
`GraphManager`: the rule that keeps a boundary as a pass-through asked the _file's_ imports rather
than the boundary's own internal edges, so the intermediate boundary between an export and the
function holding the strings was deleted as a leaf, and every graph walk dead-ended at a dependency
with no node behind it. Catalog on disk, filled, `verifyIntegrity` green, pseudo-localized in dev and
**empty in production**. Changeset: `an-export-reaches-the-strings-it-calls`.

**A third, deliberately not fixed.** The same silent-blank outcome is still reachable through a
module-level constant that an export reads:

```ts
const nav = { title: "Guide" }; // module scope
export function getSections() {
  return nav.sections;
}
```

Extraction records internal edges between two _functions_, not from a function to a module-level
binding, so nothing connects `getSections` to the strings. The obvious repair — have a named import
also depend on the module boundary — is wrong: it fails
`surgical_reachability`, which asserts that `export const x = t("…")` nobody reads stays _out_ of the
entry catalog. That is proposal 032's gate working as intended, and the two cases are only
distinguishable by dataflow the extractor does not currently record. The site sidesteps it by
building its tree in a function, which it wants anyway (§11.3). Left as a follow-up, and it deserves
a proposal rather than a patch.

### 11.3 A finding worth keeping

**Module-scope translated constants are evaluated once, before the locale exists.** ES imports are
hoisted, so a `const` holding `_t()` calls resolves during import — before `main.ts`'s
`await zintl()` has settled — and never re-resolves, because only components carry the reactive
subscription the Vue facet injects. The site's navigation tree is therefore a _function_ called per
render, and the components that read it touch the route's locale so the call re-runs on a switch. Any
project putting prose in a shared data module needs the same shape; it is the kind of thing that
belongs in the Guide, and §9.4 should say so.

**Zintl's stitched markup does not receive Vue's scoped-style attribute.** A headline that is one
translatable sentence containing two `<span>`s comes back through `v-html`, and Vue stamps
`data-v-*` only on elements its own template compiler emits — so a plain `.class` rule in
`<style scoped>` never matches. `:deep()` is the fix. The alternative, splitting the sentence into
three so every span is template-emitted, is exactly the trade this project exists to refuse. Also
Guide material, and the clearest example of stitching earning its keep.

## 12. What building §9.2 changed

The `.md`-as-localized-asset path works exactly as `configuration.md` describes it, which is the
answer §9.2 existed to get. Three more defects surfaced on the way, all in the same seam — what
counts as markup, and what a lazy route brings with it.

**A `>` inside a quoted attribute ended the tag.** `<nav v-if="count > 0" …>` was split at the
comparison and the remainder of the attribute list was extracted as prose, then rewritten into a
`_t(…)` call between two attributes. Changeset: `a-comparison-is-not-the-end-of-a-tag`.

**A nested `<template v-if>` ended the component.** The SFC template block matched non-greedily, so
extraction stopped at the first `</template>` and everything below it — the other branch, the
footer, the pager — was invisible. Silent: zero messages, no transform, source language everywhere.
Changeset: `a-component-has-one-template-block`.

**A lazily-routed page did not bring its own components.** Two walks disagree about what a chunk
reaches dynamically, and the catalog collection used the shallower one, so the sidebar and the table
of contents rendered empty in every locale but English. Changeset: `a-lazy-page-brings-its-components`.

### 12.1 Two findings recorded, not fixed

**A catalog chunk is requested at a path-relative URL first. FIXED.** It was the `modulepreload`
hint, not the import — the base was read from `server.config`, which a build does not have, so the
URL came out relative and resolved against the document. Every project's preloads were affected, and
the hint had therefore never warmed anything on a route below the root. Fixed with the base taken
from `configResolved`, and while there the bootstrap was taught to read the locale from the path
before storage — it was preloading whichever locale the reader last visited. Changeset:
`a-preload-that-warms-nothing`.

**A localized asset's chunk is named after its absolute path. FIXED.** The encoding itself is
load-bearing — an id ending in `.md` is typed by its extension and the generated JavaScript becomes
a `data:` URI on Rspack (L-009) — so what changed is what gets encoded: the path relative to the
project root rather than the absolute one. Same properties, no home directory, and 39 fewer
characters of filename. Changeset: `a-chunk-should-not-name-the-machine`.

**A localized asset edit blanks the page in dev.** Editing `zintl/src/content/<page>.<locale>.md`
sends an update that re-executes `src/main.ts`, which calls `createApp(App).mount("#app")` a second
time on a container that already holds an app: Vue warns, then the render dies on a null
`nextSibling` and the page goes empty until a reload. Reproduced on an unmodified build, so it
predates the work above and is recorded here rather than blamed on it. A source-string edit HMRs
cleanly, so it is specific to the artifact path. Worth checking against the Vue facet's claim that
"Vue's mount is replayable where React's `createRoot` and Svelte's `mount` are not" — on this
evidence it is replayable only where the entry is not re-executed.

### 12.2 The markdown pipeline as built

Bodies live in `src/content/`, are imported dynamically so each page is its own chunk, and are
rendered by a ~200-line subset renderer and a ~90-line highlighter in `src/lib/` — no dependency, on
a site whose second principle is that nothing ships that isn't used. Two constraints found by
building it: `vp fmt` normalizes Markdown emphasis to `_underscores_` and rewraps tables, in the
authored translation artifacts as readily as in the source, so the renderer accepts both spellings;
and the rendered HTML arrives through `v-html`, so its styles are global rather than scoped — the
same collision §11.3 records for stitched markup, met a second way.
