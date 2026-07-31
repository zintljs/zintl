<p align="center">
  <br>
  <br>
  <a href="https://github.com/zintljs/zintl" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zintljs/zintl/main/examples/website/public/favicon.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/zintljs/zintl/main/examples/website/public/favicon.svg">
      <img alt="Zintl logo" src="https://raw.githubusercontent.com/zintljs/zintl/main/examples/website/public/favicon.svg" height="80">
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
  <a href="https://npmjs.com/package/zintljs"><img src="https://img.shields.io/npm/v/zintljs.svg?color=863bff&label=" alt="npm package"></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img src="https://img.shields.io/node/v/zintljs.svg?color=6a2ee3&label=node" alt="node compatibility"></a>
  <a href="https://github.com/zintljs/zintl/actions"><img src="https://img.shields.io/badge/build-passing-success" alt="build status"></a>
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
Source Code ──▶ @zintljs/extractor (AST Scan) ──▶ @zintljs/compiler (Graph & Baking) ──▶ zintl (Vite Plugin & Runtime)
```

1. **`@zintljs/extractor`:** A pure metadata provider. It scans code syntax using high-performance AST parsers to identify translation anchors (`zintl()`), template literals, and HTML sinks without modifying source files.
2. **`@zintljs/compiler`:** The transformation orchestrator. It builds boundary graphs, resolves file dependencies, manages Levenshtein-based typo reconciliation, and generates chunked catalogs.
3. **`zintl`:** The developer-facing entry point. It exports the Vite plugin and runtime macros (`zintl()`, `t()`, `getLocale()`) used in code.

---

## Quick Start

### 1. Installation

Install the main Zintl package using Vite+:

```bash
vp install -D zintljs
```

### 2. Configure the Vite Plugin

Add the plugin to your `vite.config.ts` configuration file:

```typescript
import { defineConfig } from "vite";
import zintl from "zintljs/vite"; // the plugin — a default export

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

> The plugin lives at `zintl/vite`. The bare `zintl` entry is the **macro** you call in application code (step 3) — importing that one into `vite.config.ts` gives you an async no-op, not a plugin.

#### Plugin Options

Every option is optional; most projects only set `locales`. Full documentation, including what each option does to your build, is on the `Options` type — hover or ctrl+click it in your editor.

| Option                | Type                              | Default                          | What it does                                                                     |
| --------------------- | --------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `locales`             | `string[]`                        | `["en"]`                         | Every locale the app ships, including the source locale.                         |
| `sourceLocale`        | `string`                          | `"en"`                           | The locale your source is written in. Never written to disk (Ghost Mode).        |
| `outputDir`           | `string`                          | `"./zintl"`                      | Where catalogs are written, relative to the project root.                        |
| `catalogFormat`       | `string \| (ctx) => string`       | `<path>[.<func>].<locale>.json`  | Catalog file naming. Tokens: `[locale] [path] [dir] [name] [func] [bId] [hash]`. |
| `facets`              | `FacetsInput[]`                   | `["auto"]`                       | Which capabilities the compiler is built with. `"auto"` detects your framework.  |
| `assetsTarget`        | `(string \| AssetTargetConfig)[]` | `["md", "txt"]`                  | Static content files to localize alongside code.                                 |
| `virtualAssets`       | `boolean`                         | `false`                          | Serve localized assets from virtual modules instead of writing them to disk.     |
| `prune`               | `boolean`                         | `true`                           | Remove catalog keys once no source string produces them.                         |
| `debug`               | `boolean \| string`               | `false`                          | Verbose tracing. A string filters to one subsystem.                              |
| `logLevel`            | `LogLevel`                        | Vite's `logLevel`, then `"info"` | How much Zintl prints.                                                           |
| `similarityThreshold` | `number`                          | `0.6`                            | How similar an edited string must be to keep its translation.                    |
| `verifyIntegrity`     | `boolean`                         | `true` on build, `false` on dev  | Verify catalogs against the manifest and repair drift.                           |
| `multiplex`           | `boolean`                         | auto-detected                    | Build each locale as its own set of HTML entries.                                |
| `metadataDir`         | `string`                          | `<root>/node_modules/.zintl`     | Where the compiler keeps its own bookkeeping.                                    |

### 3. Initialize in Source Code

Establish a **Trust Anchor** in your application entry point. Every file or function calling `zintl()` forms an independent translation boundary with its own lazy catalog loading:

```typescript
// src/main.ts
import { zintl } from "zintljs/macro";

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

| Package                                        | Version                                                                                                                   | Description                                              |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------- |
| [**`zintl`**](packages/zintl)                  | [![version](https://img.shields.io/npm/v/zintljs.svg?color=863bff&label=%20)](packages/zintl/CHANGELOG.md)                | Vite plugin & macro runtime library.                     |
| [**`@zintljs/compiler`**](packages/compiler)   | [![version](https://img.shields.io/npm/v/@zintljs/compiler.svg?color=863bff&label=%20)](packages/compiler/CHANGELOG.md)   | Graph management, HTML projection & ICU baking compiler. |
| [**`@zintljs/extractor`**](packages/extractor) | [![version](https://img.shields.io/npm/v/@zintljs/extractor.svg?color=863bff&label=%20)](packages/extractor/CHANGELOG.md) | AST-based string & dependency extraction utility.        |

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) to learn about the monorepo setup, development commands, and codebase guidelines.

## License

[MIT](LICENSE).

---

## What's genuinely brilliant

**The Boundary Graph is a paradigm shift.** Most i18n systems are flat dictionaries. Zintl treats translations as a _dependency graph problem_ — the same mental model bundlers use for code splitting. The idea that "a file with a `zintl()` call becomes a trust anchor, and only strings reachable from that anchor need to be translated" is deeply correct and eliminates an entire class of bloat that ships in every other i18n library.

**Ghost Mode (Zero-Disk Source Locale) is elegant.** Generating `{ "key": "key" }` for English is genuinely redundant — the AST already has the strings. Virtualizing the source locale from the extraction manifest instead of materializing it to disk is the kind of insight that only comes from thinking about the problem correctly from first principles.

**The Intelligent Stitching engine** — treating template literals, JSX fragments, and HTML strings as _logical units_ rather than raw strings — is what separates Zintl from simple `i18next.t()` wrappers. Most systems make you manually wrap every string. Zintl reads intent from structure.

**Hive (translation memory) with fuzzy recovery** is seriously underrated. The idea that a minor edit to a source string should forward-port the existing translation (with a warning) instead of wiping it is exactly how professional translators think. Most tools just orphan translations on source changes.

---

## Where I see real risk

**The phantom boundary class of bugs is a structural vulnerability.** The aggressive extraction heuristic (`/zintl|loadI18nInstance|t\(|<|innerHTML/.test(ctx.code)`) runs on every file before the graph is built. The fix we applied today — gating at `verifyIntegrity` and `syncSingleAsset` — is correct, but it means phantom extractions _exist silently in the manifest_ even when they're eventually blocked from writing. In a large project with many non-anchored files, this is unneeded memory and CPU pressure on every build. The longer-term fix would be to not extract at all when there are no entries — but that requires knowing the graph before extracting, which is a chicken-and-egg problem with the current sequential pipeline.

**The `resolve.ts` hook is doing too much.** That file is 636 lines handling multiplexing, asset registration, SFC proxy files, HTML fanning, virtual module resolution, AND the translation-neutrality traversal. It's a load-bearing monolith. Any new framework (vinext, Nuxt, Astro) that has a slightly different module resolution model will cause subtle bugs here. Each concern deserves its own hook.

**The "special cases" are accumulating.** HTML projections, SSR boundaries, HTML fanning, zero-config mode, zintl markers vs. macros vs. anchors — each is individually justified, but the interaction surface is growing. The test suite is the only thing holding this together right now, and there are already 5 skipped tests.

---

## The meta-observation

Zintl is solving the _right_ problem — most i18n tools treat internationalization as a runtime lookup problem, when it's actually a **compilation and bundling problem**. The strings that need to be translated are known at build time. The code-splitting boundary that determines which strings load when is known at build time. Zintl is the only system I know of that treats both of these facts seriously.

The risk is that the implementation complexity is approaching the complexity of the problem it's solving. That's usually a sign that the abstraction layer needs a checkpoint — either a stricter API surface (fewer escape hatches), or a cleaner separation between the extractor (which should be dumb and greedy), the compiler (which should be the authority on what's "real"), and the runtime (which should be minimal and trust the compiler completely).

The bones are exceptional. The muscle needs careful discipline as the feature surface grows.
