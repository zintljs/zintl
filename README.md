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

<h1 align="center">Zintl(𝐢𝟖𝐧)</h1>

<p align="center">
  <strong>Write your app in plain language. Ship it in every language.</strong>
</p>

<p align="center">
  <a href="https://npmjs.com/package/zintljs"><img src="https://img.shields.io/npm/v/zintljs.svg?color=863bff&label=" alt="npm package"></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img src="https://img.shields.io/node/v/zintljs.svg?color=6a2ee3&label=node" alt="node compatibility"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/zintljs.svg?color=6a2ee3" alt="license"></a>
</p>

<br/>

Zintl (pronounced `/tsɪntl/`) is a compile-time internationalization engine.

Most i18n libraries ask you to change how you write code — wrap every string in `t()`, invent a key for it, keep a dictionary in sync by hand. Zintl doesn't. You write normal strings; the compiler finds them, works out which ones each part of your app actually needs, and ships exactly those.

```js
import { zintl } from "zintljs/macro";

await zintl(userLocale); // that's the whole API

document.querySelector("#app").innerHTML = `<h1>Welcome back!</h1>`;
```

No keys. No wrappers. No dictionary to maintain.

## Why it's different

**It treats translation as a bundling problem, not a lookup problem.** Which strings exist, and which screen needs them, are both known at build time. Zintl builds a graph from that — so a user who opens your settings page downloads the settings translations, not all of them.

**Nothing ships that you don't use.** Plurals and grammar rules are compiled into plain JavaScript at build time, so no ICU parser reaches the browser. Your source locale is never written to disk at all — the compiler already has those strings.

**Your source stays clean.** Grammar complexity lives in translation files where translators work, not tangled through your components.

## Quick start

```bash
npm install -D zintljs
```

Add the plugin:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import zintl from "zintljs/vite";

export default defineConfig({
  plugins: [zintl({ locales: ["en", "ar", "fr"] })],
});
```

Set a locale anywhere in your app:

```ts
// src/main.ts
import { zintl } from "zintljs/macro";

const locale = new URLSearchParams(location.search).get("lang") ?? "en";
await zintl(locale);
```

Run your dev server. Zintl extracts your strings and writes a translation file per locale, ready to fill in.

Then move the file, rename the component, restructure the directory — the translations follow. Identity is content-based rather than path-based, so nothing is attached to where a string happened to live. Restructuring an app normally costs a day of reconciling catalogs afterwards; here it costs nothing.

### One locale, or a choice?

What you pass to `zintl()` decides what gets built:

```ts
await zintl(locale); // a variable → every locale ships, switchable at runtime
await zintl("fr"); //  a literal  → this page IS French; nothing else ships
```

A literal is a promise the compiler can keep: it bakes that locale straight into the bundle, emits no catalog chunk, and leaves the other locales out entirely — the source language isn't even in the output. Ideal for a per-locale static build. Reach for a variable whenever a user can change language.

→ **[Full guide](docs/)** · [Configuration](docs/configuration.md) · [Comment directives](docs/directives.md) · [Plurals & grammar](docs/icu.md)

## Where it runs

Today Zintl ships a **Vite plugin**, and works with **React, Vue, Svelte, and vanilla** apps — client-rendered, server-rendered, and multi-page alike. Every example in [`examples/`](examples) is a real app the test suite drives end to end.

That list is a starting point, not the design. The extractor carries no framework knowledge, the compiler is bundler-agnostic, and both frameworks and toolchains are composed from **facets** — so support for another framework or another build tool is something you add, not something the core has to be rewritten around. More of both are coming.

## Packages

| Package                                    | Description                                          |
| :----------------------------------------- | :--------------------------------------------------- |
| [`zintljs`](packages/zintl)                | The plugin and the macro you import. **Start here.** |
| [`@zintljs/compiler`](packages/compiler)   | Boundary graph, chunking, and grammar compilation.   |
| [`@zintljs/extractor`](packages/extractor) | Framework-blind string extraction.                   |

Most projects only ever install `zintljs`.

## Status

Zintl is in **alpha**. The ideas are settled and the test suite is thorough — 18 example apps driven through real browsers on every change — but the API can still move between releases. Pin your version, and please [open an issue](https://github.com/zintljs/zintl/issues) when something surprises you. Early reports shape this more than anything else right now.

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) for the monorepo layout and development commands. If a concept name is unfamiliar, the [glossary](docs/glossary.md) is the fastest way in.

## License

[MIT](LICENSE) © Khalid F. Shuhail
