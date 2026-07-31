# @zintljs/compiler

> Bundler-agnostic compiler intelligence for [Zintl](https://github.com/zintljs/zintl).

[![npm version](https://img.shields.io/npm/v/@zintljs/compiler.svg?color=863bff&label=)](https://npmjs.com/package/@zintljs/compiler)

This is an **internal package**. You almost certainly want [`zintljs`](https://npmjs.com/package/zintljs) instead — it bundles this compiler behind a ready-to-use Vite plugin.

Install it directly only if you are building a Zintl integration for a bundler other than Vite.

## What it does

`@zintljs/compiler` is the transformation orchestrator of the Zintl pipeline. It takes extraction results and turns them into optimized, chunk-aware translation catalogs:

- **Boundary graph construction** — walks module dependencies from each `zintl()` trust anchor to determine which files contribute strings to which catalog.
- **Chunk computation** — partitions catalogs into entry, lazy, and shared chunks that align with your bundler's own code-splitting boundaries.
- **ZCU baking** — compiles ICU MessageFormat expressions (plurals, selects, nesting) into plain JavaScript conditionals at build time, so no ICU parser is shipped to the client.
- **Smart reconciliation** — uses Levenshtein distance to carry translations forward across minor source-string edits, so a typo fix doesn't cost you a translator round-trip.
- **Ghost-mode source locale** — virtualizes the source locale from the extraction manifest instead of writing redundant `{ "key": "key" }` files to disk.

## Architecture

```
Source Code ──▶ @zintljs/extractor ──▶ @zintljs/compiler ──▶ zintl (Vite plugin & runtime)
                   (AST scan)          (graph & baking)      (integration)
```

Behavior is resolved through a **faceted architecture**: framework and toolchain concerns are composed from discrete, orthogonal facets (`react`, `ssr`, `vite`, `client-spa`) rather than framework conditionals. Conflicting facets are detected and rejected at instantiation.

## Installation

```bash
npm install @zintljs/compiler
```

## Requirements

- Node.js `^22.18.0 || >=24.11.0`

## License

[MIT](./LICENSE) © Khalid F. Shuhail
