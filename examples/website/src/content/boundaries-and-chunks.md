# Boundaries and chunks

Zintl treats translation as a bundling problem. Everything below follows from that.

## The pipeline

```
your code ──▶ extractor ──▶ compiler ──▶ plugin + runtime
              (what's        (what goes    (what the browser
               there)         together)     actually loads)
```

The **extractor** reads your source with a parser and reports what it finds. It never modifies files and carries no framework knowledge — React, Vue and Svelte behaviour all arrive as configuration.

The **compiler** decides what belongs together: it builds the boundary graph, splits catalogs into chunks, compiles grammar, and keeps translations attached to strings as those strings change.

The **plugin and runtime** connect that to your build tool and your browser.

## Anchors and boundaries

A call to `zintl(locale)` is a **trust anchor** — a point where your app decides what language it is in.

From each anchor, Zintl walks the imports reachable from it and collects every string that could appear. That set is a **boundary**, and a boundary becomes a catalog chunk.

```
src/main.ts        zintl(locale) ──┐
  └─ Header.tsx                    ├──▶ one boundary, one chunk
     └─ Nav.tsx                  ──┘

src/admin.ts       zintl(locale) ──┐
  └─ Charts.tsx                    ├──▶ a different boundary
                                 ──┘
```

Every anchor is independent. A `zintl()` call nested inside a function is its own boundary with its own loading lifecycle — it deliberately does not inherit from anything above it, so what loads is predictable rather than accidental.

The payoff: someone who opens your settings page downloads the settings translations. Not all of them.

## Why not one dictionary

The usual approach is a single object holding every string, loaded up front. It is simple, and it means a visitor reading your landing page downloads translations for screens they will never see. That cost grows with your app and stays invisible until it is large.

Chunking translations along the boundaries your bundler already uses makes the two consistent: the translations for a lazily-loaded route arrive with that route.

## Identity is content-based

A boundary is identified by a hash of what is in it, not by the path it came from. Move a file and the boundary is the same boundary.

This is why refactoring does not cost you a day of reconciling catalogs afterwards, and it is a constraint the codebase holds itself to: anything that ties translation identity to a file path or a line number is a regression.

## Extraction is structural

Zintl does not extract raw strings; it extracts **units of meaning**. Template literals, JSX fragments and HTML are stitched into logical pieces first, so that:

- a sentence split across tags stays one translatable sentence,
- interpolated values become stable placeholders rather than positional noise,
- the same fragment produces the same key wherever it appears.

That last point is what lets translations survive refactors. This site's own headline is one key containing two `<span>`s, because it is one sentence.

## Facets

Framework support, SSR, asset handling and bundler integration are separate composable pieces called **facets**, resolved when the compiler is constructed rather than scattered as conditionals through it.

Adding a framework or a build tool means contributing a facet, not editing the core. Two facets claiming the same file extension is a hard error rather than a silent last-one-wins.

Rsbuild is the test of that claim. It runs on Rspack, whose plugin model is about as unlike Rollup's as a bundler's gets, and it reached parity without a single Rspack branch in the compiler.

## Next

| To               | Read                                      |
| :--------------- | :---------------------------------------- |
| Look up a term   | [Glossary](/concepts/glossary)            |
| See every option | [Configuration](/reference/configuration) |
