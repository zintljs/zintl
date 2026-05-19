# @zintl/extractor

## 0.0.3

### Patch Changes

- d2d7d9b: Optimize HTML and JSX extraction, phrasing-tag normalization, and comment directive handling:
  - **Nested Phrasing Tag Support**: Flawlessly parses and normalizes deeply nested phrasing tags (e.g., `<a>read <code>instructions</code></a>`) without disrupting tag open/close balances or generating malformed outputs.
  - **Transparent Phrasing Directives**: Allows HTML comment directives (`@zintl-note` and `@zintl-pass`) to live inside phrasing tag boundaries without partitioning the translatable string, propagating meta annotations seamlessly to translators.

## 0.0.2

### Patch Changes

- Optimize HTML and JSX extraction and phrasing-tag normalization:
  - **Phrasing Tag Collapsing**: Collapses exactly identical phrasing tag configurations (e.g. identical `<span>` tags) to a single clean base alias, avoiding redundant numbering and duplicate entries in translation catalogs.
  - **Heterogeneous Tag Numbering**: Retains stable numbering (`span1`, `span2`) exclusively for tags that carry different classes, attributes, or IDs to preserve translation safety.

## 0.0.1

### Patch Changes

- Normalize Windows-style CRLF (`\r\n`) line endings to LF (`\n`) at the start of both JS/TS and HTML extraction pipelines. This guarantees platform-independence and prevents range/offset alignment mismatches.
