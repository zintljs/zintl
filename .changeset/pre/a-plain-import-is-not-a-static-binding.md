---
"@zintljs/compiler": patch
"zintljs": patch
---

Make a plainly imported localized asset follow the active locale, instead of only the build.

Targeting an asset says its content varies by language. For an asset imported with `?raw` that has
always held. For one imported plainly — a `.webp`, a `.pdf`, a video, anything you want the _URL_ of
— it held in a production build and nowhere else. Every dev server, and every app that switches
language at runtime, served the source file in all locales.

The cause is that a plain import is a **static binding**: it resolves once, to one file, and nothing
re-reads it when the locale changes. So reference delivery followed the locale exactly where module
_identity_ did — a multiplexed build, where resolution rewrites each import per locale — and the
per-locale URLs sitting in the catalog were never read by anything.

An import of a targeted asset now resolves to a module that reads the active locale on every access,
which is what the `?raw` side has always done. The two delivery modes are the same shape and differ
only in what the catalog holds: the artifact's text for one, the bundler's URL for the other. The
bundler still emits and hashes each locale's file exactly as it would any asset — there is no new
emission path and no host-specific code.

The source locale is answered by a direct import rather than through the catalog, because its artifact
_is_ the source file: nothing to look up, and under ghost mode no catalog on disk to look it up in.

**`ContentFacet` gained `deliversUrl`,** which is the question this needed and `match` could not
answer. Ownership says whose file something is; it is not a licence to intercept an import of it. The
first attempt gated on ownership, claimed every `.html` — owned by the HTML projection facet, which
delivers nothing to an importer — and fed the page template to the JavaScript parser. A facet that
answers imports with a per-locale URL now says so.

Two smaller things came with it. Generated modules for this path get their own virtual id rather than
borrowing the asset's, for the reason ledger L-009 documents and one more: unplugin materialises a
virtual module as a real file elsewhere on disk, where a bare `virtual:zintl/runtime/internal` no
longer resolves. And the imports the catalog uses to reach each artifact carry `?zintl-url`, which the
plugin declines — without it the generated module imports itself.

Found by a contract that was written red and left `pending` for a release, asserting the behaviour
this change delivers.
