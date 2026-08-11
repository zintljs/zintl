# How it works

Zintl treats translation as a **bundling problem**. Two facts make that possible: which strings exist is known at build time, and which screen needs them is known at build time. Everything else follows.

## The pipeline

```
your code ──▶ extractor ──▶ compiler ──▶ plugin + runtime
              (what's        (what goes    (what the browser
               there)         together)     actually loads)
```

**The extractor** reads your source with an AST parser and reports what it finds. It never modifies files, and it carries no framework knowledge — React, Vue, and Svelte behaviour all arrive as configuration rather than being baked in.

**The compiler** decides what belongs together. It builds the boundary graph, splits catalogs into chunks, compiles grammar rules, and keeps translations attached to strings as those strings change.

**The plugin and runtime** connect that to your build tool and your browser. Today that's Vite; the compiler doesn't know or care, which is what makes another build tool additive.

## Boundaries

A call to `zintl(locale)` is a **trust anchor** — a point where your app decides what language it's in.

From each anchor, Zintl walks the imports reachable from it and collects every string that could appear. That set is a **boundary**, and it becomes a catalog chunk.

```
src/main.ts        zintl(locale) ──┐
  └─ Header.tsx                    ├──▶ one boundary, one chunk
     └─ Nav.tsx                  ──┘

src/admin.ts       zintl(locale) ──┐
  └─ Charts.tsx                    ├──▶ a different boundary
                                 ──┘
```

Every anchor is independent. A `zintl()` call nested inside a function is its own boundary with its own loading lifecycle — it deliberately doesn't inherit from anything above it, so what loads is predictable rather than accidental.

The payoff: a user who opens your settings page downloads the settings translations. Not all of them.

## What you pass to an anchor

The argument isn't just a value — it tells the compiler how much of your app is still undecided at build time.

```ts
await zintl(locale); // a variable: the locale is a runtime decision
await zintl("fr"); //  a literal:  the locale is a build-time fact
```

A literal is a fact the compiler can act on. It bakes that locale's strings directly into the bundle and stops treating the other locales as reachable — so nothing is left to load. Measured on a two-string probe with `locales: ["en", "fr"]`:

|                                 | `zintl("fr")` | `zintl(locale)` |
| :------------------------------ | :------------ | :-------------- |
| Catalog chunk emitted           | none          | yes             |
| Chunks in output                | 1             | 2               |
| Source-locale strings in bundle | **absent**    | present         |

Note the third row: with a literal, the English text isn't in the output at all. The page doesn't "default to English" — English was never built. That's the intended behaviour, and it's the same principle as everywhere else in Zintl: nothing ships that can't be reached.

**Use a literal** when a page is genuinely one language — a per-locale static build, a localized landing page, a route generated once per locale.

**Use a variable** the moment a user can change language, or the locale comes from a URL, a cookie, a header, or a preference.

Getting this backwards is quiet rather than loud: a literal in an app with a language switcher builds cleanly and then can't switch, because the other locales were never emitted.

## Why not just a dictionary

The usual approach is one big object of every string in the app, loaded up front. It's simple, and it means a user reading your landing page downloads translations for screens they'll never see. That cost grows with your app and is invisible until it's large.

Chunking translations along the same boundaries your bundler already uses for code makes the two consistent — the translations for a lazily-loaded route arrive with that route.

## Extraction is structural

Zintl doesn't extract raw strings; it extracts **units of meaning**. Template literals, JSX fragments, and HTML strings are stitched into logical pieces first, so that:

- a sentence split across tags stays one translatable sentence,
- interpolated values become stable placeholders (`{count}`) rather than positional noise,
- the same UI fragment produces the same key wherever it appears.

That last point is what lets translations survive refactors. Moving a component doesn't invent new keys.

## Nothing you don't use

- **Grammar compiles away.** Plural and select rules become JavaScript conditionals at build time; no ICU parser is shipped.
- **The source locale is never written to disk.** Generating `{"key": "key"}` is redundant when the compiler already has the strings — it virtualizes them instead.
- **Dev-only code is eliminated at build time**, not guarded at runtime.

## Facets

Framework support, SSR, asset handling, and bundler integration are separate composable pieces called **facets**, resolved when the compiler is constructed rather than being conditionals scattered through it.

Practically: adding a framework or a build tool means contributing a facet, not editing the core. Each facet declares when it applies, so nothing in the core maps frameworks to facets — and every activation decision is traced, so "why is that facet on?" has an answer. Conflicting facets — two claiming the same file extension, say — are a hard error rather than a silent last-one-wins.

That's the design that makes "more frameworks and build tools are coming" a matter of work rather than of rewriting.

Rsbuild is the test of that claim. It runs on Rspack, whose plugin model is about as unlike Rollup's as a bundler's gets, and it reached feature parity for SPA builds _and_ dev-time hot updates without a single Rspack branch in the compiler. Two things made that possible, and they divide the work the same way everything above does:

- **What the compiler decides is host-neutral.** Which strings changed, which boundaries that dirties, which catalogs must be rebuilt — none of it mentions a bundler, so both hosts run the identical code.
- **How a host is _told_ differs, and that difference is a seam.** Vite is asked for a module list and handed one back, so Zintl walks its module graph. Rspack rebuilds whatever its own dependency graph says is stale, so Zintl instead declares what each generated catalog is derived from and lets Rspack work it out. Same decision, two applications of it, neither one leaking into the other.

The parts that remain Vite-only — per-locale HTML fan-out (`multiplex`) and SSR — are unbuilt rather than blocked, and a bundler that has not built them says so through its facet, so combining them fails loudly instead of silently.
