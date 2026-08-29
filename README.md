<h1 style="display: flex; gap: 10px; align-items: center" >
  <a href="https://github.com/zintljs/zintl" target="_blank" rel="noopener noreferrer">
    <picture>
      <img alt="Zintl logo" src="https://raw.githubusercontent.com/zintljs/zintl/main/examples/website/public/favicon.svg" height="60">
    </picture>
  </a> 
  Zintl
</h1>

<p>
  <strong>Write your app in plain language. Ship it in every language.</strong>
</p>

<p>
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

| Host                                                           | Frameworks                                      | App shapes                              | Status                                                                     |
| :------------------------------------------------------------- | :---------------------------------------------- | :-------------------------------------- | :------------------------------------------------------------------------- |
| **[Vite](https://vite.dev)** 6 / 7 / 8                         | React, Preact, Solid, Vue, Svelte, Lit, vanilla | SPA, MPA, SSR, per-locale static builds | Supported                                                                  |
| **[Rsbuild](https://rsbuild.dev)** 2.x                         | React, Preact, Solid, Vue, Svelte, Lit, vanilla | SPA, MPA                                | Supported — [no SSR, no per-locale fan-out](docs/configuration.md#rsbuild) |
| **Next.js via [vinext](https://github.com/cloudflare/vinext)** | React (App Router, RSC)                         | SSR                                     | Experimental — [see below](docs/configuration.md#nextjs-via-vinext)        |

Every row but the last is driven end to end by the contract suite: real browsers against real apps, on every change.

**What is not supported**, and why — Zintl needs a plugin seat in the bundler that owns your chunk graph:

- **Next.js on webpack or Turbopack.** Turbopack has no public plugin API, and we are not building on the bundler Next.js is deprecating. `vinext` is the supported path, and it is experimental.
- **Nuxt, SvelteKit, Astro, Remix, TanStack Start.** These run on Vite, so the plugin _will_ load and appear to work. Nothing here is tested, and their routing and SSR entry shapes are not modelled. Treat as unexplored rather than working.
- **webpack, Rollup, esbuild, Farm.** No bundler facet claims these hosts, so the plugin refuses to build rather than emitting something subtly wrong.

If you hit one of these, [say so in an issue](https://github.com/zintljs/zintl/issues) — which host to reach for next is a decision we would rather make from reports than from guesses.

That list is a starting point, not the design. The extractor carries no framework knowledge, the compiler is bundler-agnostic, and both frameworks and toolchains are composed from **facets** — so support for another framework or another build tool is something you add, not something the core has to be rewritten around. Rsbuild was the proof: it runs on Rspack, whose plugin model is about as unlike Vite's as a bundler's gets, and it arrived without a single Rspack branch in the compiler. More of both are coming.

## Packages

| Package                                    | Description                                          |
| :----------------------------------------- | :--------------------------------------------------- |
| [`zintljs`](packages/zintl)                | The plugin and the macro you import. **Start here.** |
| [`@zintljs/compiler`](packages/compiler)   | Boundary graph, chunking, and grammar compilation.   |
| [`@zintljs/extractor`](packages/extractor) | Framework-blind string extraction.                   |

Most projects only ever install `zintljs`.

## Status

Zintl is in **alpha**, heading for beta. The ideas are settled and the suite is thorough — 27 projects, 19 of them real example apps, driven through real browsers on every change, with no retries anywhere. The API can still move, so pin your version.

[**Stability**](docs/stability.md) says which surfaces are settled and which are still in motion, rather than leaving "alpha" to mean everything is.

**Adopting Zintl is reversible in one commit**, and that is worth knowing before you decide rather than after. Your source never changed — no `t()` wrappers to unwind, no keys to delete, no dictionary to reconcile — so removing the plugin leaves the monolingual app you started with, compiling and running. [How that works.](docs/stability.md#removing-zintl)

Please [open an issue](https://github.com/zintljs/zintl/issues) when something surprises you. Early reports shape this more than anything else right now — including "I could not work out how to…", which is a documentation bug and is treated as one.

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) for the monorepo layout and development commands. If a concept name is unfamiliar, the [glossary](docs/glossary.md) is the fastest way in.

## License

[MIT](LICENSE) © Khalid F. Shuhail
