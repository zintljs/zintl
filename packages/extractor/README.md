# @zintljs/extractor

> AST-based message extractor for [Zintl](https://github.com/zintljs/zintl).

[![npm version](https://img.shields.io/npm/v/@zintljs/extractor.svg?color=863bff&label=)](https://npmjs.com/package/@zintljs/extractor)

This is an **internal package**. You almost certainly want [`zintljs`](https://npmjs.com/package/zintljs) instead — it bundles this extractor behind a ready-to-use Vite plugin.

Install it directly only if you are building custom tooling on top of Zintl's extraction layer.

## What it does

`@zintljs/extractor` is a **pure metadata provider**. It scans source syntax with high-performance [oxc](https://oxc.rs) AST parsers and reports what it finds. It never modifies your source files.

It is deliberately **framework-blind** — it carries no implicit knowledge of React, Vue, or Svelte. All framework behavior is supplied by the caller through configuration.

## Intelligent stitching

The extractor does not emit raw string literals. It stitches template literals, JSX fragments, and HTML strings into logical **Stitched Units**:

- **HTML fragmentation** — large `innerHTML` strings are split along tag boundaries. Translatable text between tags becomes its own key; the tags themselves are preserved as structure.
- **Variable normalization** — unnamed expressions are normalized to stable placeholders (`{input}`, `{inputN}`), so identical UI fragments share a translation key regardless of their position in a template.
- **Comment directives** — `@zintl-ignore`, `@zintl-note`, and `@zintl-pass` are recognized and attached to the units they annotate.

## Installation

```bash
npm install @zintljs/extractor
```

## Requirements

- Node.js `^22.18.0 || >=24.11.0`

## License

[MIT](./LICENSE) © Khalid F. Shuhail
