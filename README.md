<p align="center">
  <a href="https://github.com/zintljs/zintl" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zintljs/zintl/main/examples/website/public/favicon.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/zintljs/zintl/main/examples/website/public/favicon.svg">
      <img alt="Zintl logo" src="https://raw.githubusercontent.com/zintljs/zintl/main/examples/website/public/favicon.svg" height="80">
    </picture>    
  </a>
</p>

<h1 align="center">Zintl(𝐢𝟖𝐧)</h1>

<p align="center">
  <strong>Write your app in plain language. Ship it in every language.</strong>
</p>

<p align="center">
  <a href="https://npmjs.com/package/zintljs"><img alt="npm version" src="https://img.shields.io/npm/v/zintljs?label=&color=F4795E&labelColor=1B1420&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48bWFzayBpZD0ibSI%2BPHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiMwMDAiLz48cGF0aCBkPSJNMTYgNDVWODRNMTYgMjR2MU02MiA4NFY1ME02MiA2MGExNCAxNCAwIDAgMSAyOCAwdjI0IiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMTMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjM5IiBjeT0iNTIiIHI9IjIxLjUiLz48Y2lyY2xlIGN4PSIzOSIgY3k9Ijc0IiByPSIyMyIvPjxjaXJjbGUgY3g9IjM5IiBjeT0iNTIiIHI9IjE3LjUiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIzOSIgY3k9IjczIiByPSIxOSIgZmlsbD0iI2ZmZiIvPjxjaXJjbGUgY3g9IjM5IiBjeT0iNTIiIHI9IjUiLz48Y2lyY2xlIGN4PSIzOSIgY3k9Ijc0IiByPSI2LjUiLz48L21hc2s%2BPHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmZmYiIG1hc2s9InVybCgjbSkiLz48L3N2Zz4%3D"></a>
  <a href="https://github.com/zintljs/zintl/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/zintljs/zintl/ci.yml?branch=main&label=CI&labelColor=1B1420&logo=githubactions&logoColor=fff"></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img alt="node compatibility" src="https://img.shields.io/node/v/zintljs?label=node&color=E8309C&labelColor=1B1420&logo=nodedotjs&logoColor=fff"></a>
  <a href="docs/"><img alt="documentation" src="https://img.shields.io/badge/docs-guide-B44BE0?labelColor=1B1420&logo=bookstack&logoColor=fff"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/npm/l/zintljs?label=license&color=1B1420&labelColor=1B1420&logo=opensourceinitiative&logoColor=fff"></a>
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

<details>
<summary>Using Rsbuild instead?</summary>

```ts
// rsbuild.config.ts
import { defineConfig } from "@rsbuild/core";
import zintl from "zintljs/rsbuild";

export default defineConfig({
  plugins: [...zintl({ locales: ["en", "ar", "fr"] })],
});
```

Same plugin, same options — note the spread, since the Rsbuild entry point returns an array. [What's covered there.](docs/configuration.md#rsbuild)

</details>

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

Zintl ships a **Vite plugin** and an **[Rsbuild](https://rsbuild.dev) plugin**, and works with **React, Vue, Svelte, and vanilla** apps. On Vite that means client-rendered, server-rendered, and multi-page alike; on Rsbuild it means single-page apps, in production builds and in dev — see [the Rsbuild section](docs/configuration.md#rsbuild) for what is and is not covered there. Every example in [`examples/`](examples) is a real app the test suite drives end to end, on both bundlers.

That list is a starting point, not the design. The extractor carries no framework knowledge, the compiler is bundler-agnostic, and both frameworks and toolchains are composed from **facets** — so support for another framework or another build tool is something you add, not something the core has to be rewritten around. Rsbuild was the proof: it runs on Rspack, whose plugin model is about as unlike Vite's as a bundler's gets, and it arrived without a single Rspack branch in the compiler. More of both are coming.

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
