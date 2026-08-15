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
  <a href="https://github.com/zintljs/zintl/tree/main/docs"><img alt="documentation" src="https://img.shields.io/badge/docs-guide-B44BE0?labelColor=1B1420&logo=bookstack&logoColor=fff"></a>
  <a href="https://github.com/zintljs/zintl"><img alt="GitHub repository" src="https://img.shields.io/badge/GitHub-zintljs%2Fzintl-1B1420?labelColor=1B1420&logo=github&logoColor=fff"></a>
</p>

<br/>

Zintl is a compile-time internationalization engine.

Most i18n libraries ask you to change how you write code — wrap every string in `t()`, invent a key for it, keep a dictionary in sync by hand. Zintl doesn't. You write normal strings; the compiler finds them, works out which ones each part of your app actually needs, and ships exactly those.

## Install

```bash
npm install -D zintljs
```

<sub>or `pnpm add -D zintljs` · `yarn add -D zintljs`</sub>

## Use

**1. Add the plugin.**

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

Same plugin, same options — note the spread, since the Rsbuild entry point returns an array. Everything below applies unchanged. [What's covered there.](https://github.com/zintljs/zintl/blob/main/docs/configuration.md#rsbuild)

</details>

**2. Set a locale.**

```ts
// src/main.ts
import { zintl } from "zintljs/macro";

const locale = new URLSearchParams(location.search).get("lang") ?? "en";
await zintl(locale);

document.querySelector("#app").innerHTML = `<h1>Welcome back!</h1>`;
```

That's the whole API. No keys, no wrappers, no dictionary to maintain.

> **What you pass matters.** A variable ships every locale and lets users switch at runtime. A literal — `zintl("fr")` — tells the compiler this page _is_ French: it bakes that locale in, emits no catalog chunk, and leaves every other locale out of the bundle, source language included. Use a literal for per-locale static builds, a variable whenever language is a choice.

> `zintljs/vite` (or `zintljs/rsbuild`) is the plugin; `zintljs/macro` is what you call in app code. Importing the wrong one into your config gives you an async no-op rather than a plugin.

**3. Run your dev server.** Zintl extracts your strings and writes one file per locale, ready to fill in:

```json
// zintl/src/main.fr.json
{
  "Welcome back!": ""
}
```

Fill it in and the page updates without a reload. Leave it empty and the production build refuses to ship — a blank string is a bug, not a fallback.

## What you get

**Only what each screen needs.** Zintl works out which strings are reachable from which entry point, and splits catalogs along the same lines your bundler splits code. Opening the settings page downloads the settings translations, not all of them.

**Nothing extra in the bundle.** Plurals and grammar rules compile to plain JavaScript at build time — no ICU parser reaches the browser. Your source locale is never written to disk; the compiler already has those strings.

**Translations that survive refactors.** Identity is content-based, not path-based — so translations aren't attached to a file, a line, or a key you have to keep stable. Rename components, move files, restructure whole directories: the translations follow. Even a source string edited into a near-identical one keeps what it had, instead of being orphaned and sent back to translators.

Restructuring an app usually means a day of reconciling catalogs afterwards. Here it means zero.

**Grammar where it belongs.** Source files keep simple template literals; plural and gender rules live in the catalog, with a generated JSON schema so translators get autocomplete.

```ts
const msg = `You have ${count} items in your cart`;
```

```json
{
  "You have {count} items in your cart": "{count, plural, =0 {سلتك فارغة} one {لديك عنصر واحد} other {لديك {count} عناصر}}"
}
```

## Where it runs

Works with **React, Vue, Svelte, and vanilla** apps, on **Vite 6, 7 or 8** or on **[Rsbuild](https://rsbuild.dev) 2** — install whichever you build with; both are optional peer dependencies. Node `^22.18.0 || >=24.11.0`.

On Vite that covers client-rendered, server-rendered and multi-page apps, with all four frameworks. On Rsbuild it covers single-page and multi-page apps in **React, Svelte and vanilla JavaScript**, in production builds and in dev. Two exclusions there are worth knowing before you start: per-locale HTML fan-out (`multiplex`) and SSR are Vite-only, and combining them with Rsbuild fails your build with a clear error rather than doing nothing quietly — while **Vue on Rsbuild is not supported and fails quietly**, building green and shipping the source locale, so use Vite for Vue. [The full comparison.](https://github.com/zintljs/zintl/blob/main/docs/configuration.md#rsbuild)

That list is a starting point, not the design. The extractor carries no framework knowledge and the compiler is bundler-agnostic, so another framework or another build tool is something you add rather than something the core is rewritten around. More of both are coming.

## Docs

- [Configuration](https://github.com/zintljs/zintl/blob/main/docs/configuration.md) — every option
- [Comment directives](https://github.com/zintljs/zintl/blob/main/docs/directives.md) — `@zintl-ignore`, `@zintl-note`, `@zintl-pass`
- [Plurals & grammar](https://github.com/zintljs/zintl/blob/main/docs/icu.md)
- [Glossary](https://github.com/zintljs/zintl/blob/main/docs/glossary.md)

## Status

**Alpha.** The ideas are settled and the test suite is thorough, but the API can still move between releases. Pin your version, and please [open an issue](https://github.com/zintljs/zintl/issues) when something surprises you — early reports shape this more than anything else right now.

## License

[MIT](https://github.com/zintljs/zintl/blob/main/LICENSE) © Khalid F. Shuhail
