<p align="center">
  <br>
  <br>
  <a href="https://github.com/zintl/zintl" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="examples/website/public/favicon.svg">
      <source media="(prefers-color-scheme: light)" srcset="examples/website/public/favicon.svg">
      <img alt="Zintl logo" src="examples/website/public/favicon.svg" height="80">
    </picture>
  </a>
  <br>
  <br>
</p>

<h1 align="center">Zintl ⚡</h1>

<p align="center">
  <strong>Compiler-driven internationalization system for modern web applications.</strong>
</p>

<p align="center">
  <a href="https://npmjs.com/package/zintl"><img src="https://img.shields.io/npm/v/zintl.svg?color=863bff&label=" alt="npm package"></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img src="https://img.shields.io/node/v/zintl.svg?color=6a2ee3&label=node" alt="node compatibility"></a>
  <a href="https://github.com/zintl/zintl/actions"><img src="https://img.shields.io/badge/build-passing-success" alt="build status"></a>
</p>

<br/>

Zintl (pronounced [`/tsɪntl/`]) is a compile-time internationalization engine built to provide a faster, leaner, and zero-config localization experience for modern web projects. It moves internationalization from a runtime lookup bottleneck to a compile-time optimization pipeline.

It consists of two major parts:

- **A Vite Plugin & Runtime:** Integrates seamlessly into Vite's module graph to perform surgical code replacement, inlining, and HMR catalog updates.
- **A Compiler Core:** Builds dependency graphs, splits localized content into optimized translation chunks, and compiles target ICU formats into ultra-fast JS conditional branches at build time.

---

## Features

- ⚡ **Zero-Runtime Overhead (ZCU Baking):** Compiles ICU MessageFormat expressions (plurals, select enums, nesting) into pure JavaScript conditions at build time. No heavy parsing libraries are shipped to the client.
- 📂 **Smart Chunking & Code Splitting:** A graph-based boundary algorithm automatically partitions translations into entry-specific, lazy-loaded, and shared catalog chunks matching your bundler's code-splitting boundaries.
- 🔍 **Zero-Config Extraction:** Automatically extracts strings from JSX, template literals, and HTML structures. No manual translation key mapping or tedious function wrappers are required.
- 👻 **Zero-Disk Source Locale (Ghost Mode):** The source locale (typically English) is completely diskless. The compiler virtualizes it on-the-fly from the extraction manifest, eliminating redundant `{ "key": "key" }` files from your repository.
- 🌐 **HTML Metadata Projections:** Automatically extracts and translates standard HTML head tags (`title`, `meta[name="description"]`, and directionality `dir`). It bakes translations directly for static targets or injects a minimal head-blocking bootstrap script for dynamic targets.
- 🏷️ **Surgical Comment Directives:** Control translation behavior with inline code comments (`@zintl-ignore` with HTML tag scoping, `@zintl-note` for translator context, and `@zintl-pass` to pass grammatical context variables).
- 🔄 **Lightning Fast HMR:** Surgical invalidation of translation catalogs. Accept hot updates in-place during development with zero page reloads.

---

## Core Architecture

Zintl operates as a **Three-Package Monorepo** separating extraction, compilation, and runtime logic:

```
Source Code ──▶ @zintl/extractor (AST Scan) ──▶ @zintl/compiler (Graph & Baking) ──▶ zintl (Vite Plugin & Runtime)
```

1. **`@zintl/extractor`:** A pure metadata provider. It scans code syntax using high-performance AST parsers to identify translation anchors (`zintl()`), template literals, and HTML sinks without modifying source files.
2. **`@zintl/compiler`:** The transformation orchestrator. It builds boundary graphs, resolves file dependencies, manages Levenshtein-based typo reconciliation, and generates chunked catalogs.
3. **`zintl`:** The developer-facing entry point. It exports the Vite plugin and runtime macros (`zintl()`, `t()`, `getLocale()`) used in code.

---

## Quick Start

### 1. Installation

Install the main Zintl package using Vite+:

```bash
vp install -D zintl
```

### 2. Configure the Vite Plugin

Add the plugin to your `vite.config.ts` configuration file:

```typescript
import { defineConfig } from "vite";
import { zintl } from "zintl";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "fr"],
      outputDir: "locales",
    }),
  ],
});
```

### 3. Initialize in Source Code

Establish a **Trust Anchor** in your application entry point. Every file or function calling `zintl()` forms an independent translation boundary with its own lazy catalog loading:

```typescript
// src/main.ts
import { zintl } from "zintl/macro";

async function initApp() {
  const userLang = new URLSearchParams(window.location.search).get("lang") || "en";

  // Sets the active locale and loads necessary catalog chunks
  await zintl(userLang);

  document.querySelector("#app")!.innerHTML = `
    <h1>Welcome back!</h1>
    <p>You have successfully logged in.</p>
  `;
}

initApp();
```

---

## The Comment Directive System

Use comments directly in your source code (JavaScript `//`, `/* */` or HTML `<!-- -->`) to guide the compiler surgically:

### `@zintl-ignore`

Suppresses translation extraction for the immediate next node or HTML tag and its nested subtree:

```jsx
<div>
  {/* @zintl-ignore */}
  <span>This text will not be extracted</span>
  <span>This text will be extracted</span>
</div>
```

### `@zintl-note`

Attaches translator notes that are automatically injected into the generated translation schema:

```typescript
// @zintl-note Welcome message on the user's dashboard
const welcomeMsg = `Hello, user!`;
```

### `@zintl-pass`

Binds invisible grammatical context variables (like gender, role, or counts) to the extraction scope. This allows target languages to use advanced grammatical logic (e.g., ICU Plurals or Select) even if they aren't visible in the source English text:

```typescript
// @zintl-pass role={user.role}
const dashboardTitle = `Welcome to your dashboard!`;
```

---

## The ZCU (Component-based ICU) Agreement

Zintl implements a **Source Purity** philosophy. Developers do not write complex grammatical logic inside their source code. Instead, source files contain simple template literals, and grammatical variations are managed as catalog data:

1. **Source Code:** Write clean, standard JS template literals:
   ```typescript
   const msg = `You have ${count} items in your cart`;
   ```
2. **Target Translation Catalog (`locales/ar.json`):** Translators write standard ICU MessageFormat syntax inside the JSON files, backed by IDE auto-complete schemas:
   ```json
   {
     "$schema": "./.schemas/locales.schema.json",
     "You have {count} items in your cart": "{count, plural, =0 {سلتك فارغة} one {لديك عنصر واحد في سلتك} other {لديك {count} عناصر في سلتك}}"
   }
   ```
3. **Compilation:** At build time, the Zintl compiler parses the ICU syntax and compiles ("bakes") it into optimized JavaScript conditional logic:
   ```javascript
   // Compiled output (Smart Manager)
   (params) => {
     const { count } = params;
     if (count === 0) return `سلتك فارغة`;
     if (count === 1) return `لديك عنصر واحد في سلتك`;
     return `لديك ${count} عناصر في سلتك`;
   };
   ```

---

## Packages

| Package                                      | Version                                                                                                                 | Description                                              |
| :------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- |
| [**`zintl`**](packages/zintl)                | [![version](https://img.shields.io/npm/v/zintl.svg?color=863bff&label=%20)](packages/zintl/CHANGELOG.md)                | Vite plugin & macro runtime library.                     |
| [**`@zintl/compiler`**](packages/compiler)   | [![version](https://img.shields.io/npm/v/@zintl/compiler.svg?color=863bff&label=%20)](packages/compiler/CHANGELOG.md)   | Graph management, HTML projection & ICU baking compiler. |
| [**`@zintl/extractor`**](packages/extractor) | [![version](https://img.shields.io/npm/v/@zintl/extractor.svg?color=863bff&label=%20)](packages/extractor/CHANGELOG.md) | AST-based string & dependency extraction utility.        |

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) to learn about the monorepo setup, development commands, and codebase guidelines.

## License

[MIT](LICENSE).
