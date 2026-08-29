# Integrations

Zintl needs a plugin seat in the bundler that owns your chunk graph. That is the whole of what decides this list.

## Where it runs

| Host                   | Frameworks                                      | App shapes                              | Status       |
| :--------------------- | :---------------------------------------------- | :-------------------------------------- | :----------- |
| **Vite** 6 / 7 / 8     | React, Preact, Solid, Vue, Svelte, Lit, vanilla | SPA, MPA, SSR, per-locale static builds | Supported    |
| **Rsbuild** 2.x        | React, Preact, Solid, Vue, Svelte, Lit, vanilla | SPA, MPA                                | Supported    |
| **Next.js via vinext** | React (App Router, RSC)                         | SSR                                     | Experimental |

Every row but the last is driven end to end by the contract suite: real browsers against real apps, on every change.

## Vite

The reference integration. Everything in this documentation applies without qualification.

## Rsbuild

Chunk-aligned catalogs — including routes behind `await import()` — ghost mode, localized assets, per-locale `<html lang>` and `dir`, and dev-time string edits all carry over, with no Rspack-specific code in the compiler.

Two things are Vite-only, and they are unbuilt rather than blocked:

- **`multiplex`** — the per-locale HTML fan-out.
- **SSR.**

A bundler that has not built them says so through its facet, so combining them fails loudly instead of silently.

That Rsbuild works at all is the evidence for the facet architecture. Rspack's plugin model is about as unlike Rollup's as a bundler's gets, and reaching parity took no branches in the compiler — only a second bundler facet.

## Next.js via vinext

Experimental. React with the App Router and RSC, on Vite.

## What is not supported, and why

**Next.js on webpack or Turbopack.** Turbopack has no public plugin API, and we are not building on the bundler Next.js is moving away from. `vinext` is the supported path, and it is experimental. If you need i18n on stock Next.js today, Zintl is not the tool.

**Nuxt, SvelteKit, Astro, Remix, TanStack Start.** These run on Vite, so the plugin _will_ load and appear to work. Nothing here is tested, and their routing and SSR entry shapes are not modelled. Treat as unexplored rather than working.

**webpack, Rollup, esbuild, Farm.** No bundler facet claims these hosts, so the plugin refuses to build rather than emitting something subtly wrong.

> [!NOTE]
> If you hit one of these, [say so in an issue](https://github.com/zintljs/zintl/issues). Which host to reach for next is a decision we would rather make from reports than from guesses.

## Adding one yourself

The extractor carries no framework knowledge and the compiler is bundler-agnostic. Both are composed from **facets**, so support for another framework or build tool is something you add rather than something the core has to be rewritten around.

## Next

| To                   | Read                                                     |
| :------------------- | :------------------------------------------------------- |
| Understand facets    | [Boundaries and chunks](/concepts/boundaries-and-chunks) |
| Know what is settled | [Stability](/reference/stability)                        |
