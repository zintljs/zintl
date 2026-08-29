# Glossary

The words this documentation uses, and what each one means here.

## Anchor

See **trust anchor**.

## Artifact

The per-locale file Zintl writes for a **localized asset** — `zintl/src/about.fr.txt` beside `src/about.txt`. Created empty and authored by a person; never copied from the source.

## Boundary

The set of strings reachable from one **trust anchor**. Becomes one catalog chunk. Identified by a hash of its contents (`b_<hash>`), not by a path.

## Catalog

The translations for one source file in one language — a JSON file under `outputDir`. What translators edit.

## Chunk

What a boundary becomes in the browser: a unit the bundler loads. Entry chunks arrive with the page, lazy chunks with the route that needs them, shared chunks where two entries overlap.

## Colony

A boundary reachable from an entry only through a dynamic import. Its strings belong to that entry's world but arrive with the lazy route.

## Directive

A comment that steers the compiler — `@zintl-ignore`, `@zintl-target`, `@zintl-note`, `@zintl-pass`. See [Comment directives](/reference/comment-directives).

## Entry point

A file with a **top-level** `zintl()` call, as distinct from one nested inside a function. An entry owns a chunk.

## Facet

A composable piece of compiler behaviour covering one concern — a framework, a bundler, SSR, assets. Resolved when the compiler is constructed.

## Ghost mode

The source language is never written to disk. The compiler virtualizes it from the extraction manifest and loads it lazily only if it is the active locale.

## Localized asset

A file whose _content_ differs by language rather than a string inside a component — matched by `assetsTarget`, `.md` and `.txt` by default.

## Manager

Generated code that loads the right catalog for a boundary. Inlines the anchor's locale for a fast start and keeps the others lazy.

## Multiplex

Building one HTML document per locale, each with that language baked in. Vite only.

## Pending locale

A language being worked on: its catalogs are maintained and verified, and it is not shipped.

## Sink

A place a string is known to be user-facing — markup text, an `alt`, an assignment to `textContent`. What makes a string translatable is reaching a sink, not looking like prose.

## Source locale

The language you write in. Never written to disk, never used as a fallback.

## Stitched unit

The actual unit of extraction. Template literals, JSX fragments and HTML are stitched into logical pieces before extraction, so a sentence split across tags stays one key.

## Trust anchor

A call to `zintl(locale)` — the point your app declares what language it is in. Every anchor is independent and has its own hydration lifecycle.

## Next

| To                    | Read                                                     |
| :-------------------- | :------------------------------------------------------- |
| See how these fit     | [Boundaries and chunks](/concepts/boundaries-and-chunks) |
| Configure any of them | [Configuration](/reference/configuration)                |
