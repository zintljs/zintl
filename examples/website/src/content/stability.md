# Stability

Zintl is in alpha. This page says what that means in practice, so you can decide what to depend on.

## What is settled

These have contract tests behind them and are not expected to change shape:

- **The macro.** `zintl(locale)`, and the difference between passing a variable and a literal.
- **No fallback to the source language.** A missing translation is a build error. This is the design, not a default.
- **Content-based identity.** Moving or renaming a file does not orphan its translations.
- **Catalog format.** One JSON file per source file per language, with a schema beside it.
- **Chunk-aligned catalogs.** Translations split along your import graph.
- **Ghost mode.** The source language is never written to disk.

## What is still moving

- **Option names.** Some are more specific than they need to be and may be renamed with a deprecation.
- **Facet authoring.** The internal contract for writing your own facet is not frozen. Using the built-in ones is safe; writing one against the current interface may need adjusting.
- **SSR and streaming.** Supported on Vite, exercised by the suite, and the surface may still grow.
- **vinext.** Experimental in the sense that it is not covered end to end.

## What is not planned

- **A runtime `t()` API.** If you need to look a string up by key at runtime, Zintl is the wrong shape.
- **Automatic machine translation.** Catalogs are files; run whatever you like over them.
- **Fallback chains.** See the first list.

## Versioning

Alpha releases carry a version suffix and a matching npm dist-tag. Breaking changes ship in minors while the major is `0`, and each one arrives with a changeset explaining what moved and why.

## Removing Zintl

Worth knowing before you adopt it, and short by design:

1. Delete the plugin from your bundler config.
2. Your source is unchanged — it was always plain strings. It keeps working in your source language.
3. Delete `outputDir` if you do not want the translations.

There is no ejection step and no generated code in your repository to unpick, because Zintl never writes into your source. That is a property worth checking for in anything you let near your codebase, and it is why this page can be this short.

## Reporting something

Anything surprising, unclear or plainly broken is worth [an issue](https://github.com/zintljs/zintl/issues). Real usage reports carry more weight than anything else right now — including "I could not work out how to…", which is a documentation bug and gets treated as one.

## Next

| To              | Read                                      |
| :-------------- | :---------------------------------------- |
| Check your host | [Integrations](/reference/integrations)   |
| Start using it  | [Getting started](/guide/getting-started) |
