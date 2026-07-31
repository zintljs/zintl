---
"@zintljs/compiler": patch
"@zintljs/extractor": patch
"zintljs": patch
---

Fix evaluation of dynamic attributes, tag replacement, and boundary resolution in JSX/SFC compilation:

- **Export and Import Boundary Resolution**:
  - In `@zintljs/extractor`: Maps default and named exports of components to their precise function-level boundary IDs (e.g., `src/App:App` instead of the file boundary `src/App`) in the program visitor.
  - In `@zintljs/compiler`: Resolves static import bindings to their precise exported function-level boundary IDs when walking the dependency graph in `intent-utils.ts`, and adds file-level fallback resolution to ownership mapping checks.
- **Dynamic JSX Attribute Evaluation**: Serializes `_tags` for JSX components as raw JavaScript array literals rather than JSON strings, allowing local scope variables (like imported assets) to be correctly evaluated at runtime.
- **JSX to HTML Attribute Mapping**: Automatically maps `className` to `class`, and JSX attribute expressions like `src={logo}` to template literal interpolations `src="${logo}"` for elements inside translated templates.
- **Self-Closing Tag Placeholders**: Extends the runtime key resolver and compile-time baking to support self-closing tags (both `<tag/>` and `<tag />`) when replacing translatable element placeholders.
