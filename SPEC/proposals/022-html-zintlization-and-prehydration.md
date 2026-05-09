# Proposal: Zintlization of HTML Files (The Zero-Flicker Architecture)

## 1. Problem Statement: The "Initial View" Paradox

In modern web development, particularly Single Page Applications (SPAs), the `index.html` file serves as the static entry point. While Zintl excels at managing translations within JavaScript/TypeScript/JSX, the strings living in the `index.html` (such as `<title>`, `<meta>`, and static loading states) remain "un-zintlized."

Currently, developers must manually sync these strings using `document.title = t(...)` in their entry script. This creates:

1.  **Source of Truth Fragility**: Changing a string in `index.html` requires a manual update in `main.ts`.
2.  **The Language Flicker**: Users on slow connections see the source language (English) for a brief moment before the JS bundle hydrates and snaps the UI to the correct locale.

## 2. Core Vision: HTML as a First-Class Source

Zintl should treat HTML files not just as static templates, but as **Ghost Source Files** that belong to the nearest Top-Level Anchor (Entry Point).

### The "Zero-Glue" Goal

A developer should be able to write:

```html
<title>Zintl | My Amazing App</title>
```

...and Zintl should automatically handle extraction, cataloging, and runtime synchronization without the developer writing a single line of JS glue.

## 3. Logical Architecture: The Two Modes

The system must support two distinct strategies for HTML Zintlization, depending on the project's build target.

### A. Hydration Mode (The SPA Solution)

In this mode, Zintl maintains a single `index.html` but injects a **Pre-hydration Script**.

1.  **Extraction**: The Extractor parses `index.html`, identifying translatable nodes (title, meta, etc.).
2.  **Registry Binding**: These strings are registered to the project's entry point boundary (e.g., `main.ts`).
3.  **Pre-hydration Injection**: During the build, the Vite/Webpack plugin injects a tiny, high-priority `<script>` at the top of the `<head>`.
    - It detects the locale (URL params, localStorage, or cookies).
    - It contains an inlined, minimized map of _only_ the strings extracted from that HTML file.
    - It executes immediately, updating `document.title` and `lang` attributes before the main JS bundle even arrives.

### B. Baking Mode (The Static/SSG Solution)

When "Baking" is enabled, Zintl performs a **Static Clone-and-Replace** operation.

1.  **Template Generation**: The `index.html` is treated as a template.
2.  **Multi-Entry Output**: The compiler generates physical localized files: `index.en.html`, `index.ar.html`, `index.es.html`.
3.  **Strict Replacement**: The translatable strings are swapped statically.
    - Pros: Absolute zero JS required for the initial view. SEO friendly.
    - Cons: Requires server-side routing or a specific hosting strategy to serve the correct file.

## 4. Why This Matters: The Mental Model

The implementer must understand that Zintl is moving from **"Code-Only I18n"** to **"Project-Wide I18n"**.

- **The Shadow Dependency**: The `index.html` should be viewed as a "Shadow Dependency" of the entry point. It has strings that must live in the entry point's catalog to ensure they are available the moment the app starts.
- **The Inlining Budget**: We must be careful not to inline _all_ translations into the HTML (which would cause bloat). Only the strings actually present in the HTML file should be inlined in the Pre-hydration Script.
- **Zero Config Principle**: The user shouldn't need to configure "HTML extraction." If a `.html` file is in the module graph or root, it should be scanned.

## 5. Implementation Requirements (Outcomes)

1.  **HTML Extractor**: A new extractor module capable of parsing HTML and identifying `title`, `meta[content]`, and text nodes marked with a `@zintl` hint.
2.  **Boundary Integration**: The ability to "gift" extracted strings from an HTML file to a JS Boundary.
3.  **Vite Plugin Hook**: Implementation of `transformIndexHtml` to inject either the Pre-hydration Script or the Baked content.
4.  **Locale Detection Logic**: A standardized, lightweight JS snippet that can reliably detect the "Anchor Locale" across different routing strategies (Hash, Search Params, Path).

## 6. Conclusion

Zintlization of HTML files bridges the gap between the static world of the browser and the dynamic world of the Zintl runtime. By automating the "Initial View," we eliminate the most common UX flaw in i18n—the flicker—and solidify Zintl's promise of a truly Zero-Config internationalization system.

**Mantra**: _The bloat is dead, the paths are readable, Claritas!_
