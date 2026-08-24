# Zintl documentation

Start with the [README](../README.md) if you haven't installed Zintl yet. These pages pick up where it stops.

## Guides

| Page                                | What's in it                                                             |
| :---------------------------------- | :----------------------------------------------------------------------- |
| [Configuration](configuration.md)   | Every plugin option, what it changes, and when you'd reach for it        |
| [Comment directives](directives.md) | Steering the compiler with `@zintl-ignore`, `@zintl-note`, `@zintl-pass` |
| [Plurals & grammar](icu.md)         | How one source string becomes correct grammar in every language          |
| [How it works](architecture.md)     | Boundaries, chunking, and why translations are a graph                   |
| [Glossary](glossary.md)             | The vocabulary used across the codebase                                  |
| [Stability](stability.md)           | What is settled, what is still moving, and how to remove Zintl           |

Contributors may also want [`spec/`](spec) — the internal specifications and design notes behind these behaviours.

## Mental model, in one paragraph

You write ordinary strings. A call to `zintl(locale)` marks a **trust anchor** — a place your app decides what language it's in. Zintl walks the imports reachable from that anchor to find every string that could appear there, and that set becomes a **boundary**. Boundaries turn into catalog chunks that load the same way your bundler loads code: what the current screen needs, when it needs it. Everything else — key generation, splitting, plural compilation — falls out of that.

If you only remember one thing: **Zintl treats translation as a bundling problem.** Most of its behaviour makes sense once that clicks.

## Getting help

Something surprising, unclear, or plainly broken is worth [an issue](https://github.com/zintljs/zintl/issues). Zintl is in alpha and real usage reports carry more weight than anything else right now — including "I couldn't work out how to…", which is a documentation bug and gets treated as one.
