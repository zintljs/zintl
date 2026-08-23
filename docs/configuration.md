# Configuration

Every option is optional. Most projects set `locales` and never touch the rest.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import zintl from "zintljs/vite";

export default defineConfig({
  plugins: [
    zintl({
      locales: ["en", "ar", "fr"],
    }),
  ],
});
```

Each option is documented on the `Options` type too — hover or ctrl-click it in your editor.

## Locales

| Option         | Type       | Default  | What it does                                                                                          |
| :------------- | :--------- | :------- | :---------------------------------------------------------------------------------------------------- |
| `locales`      | `string[]` | `["en"]` | Every locale your app ships, including the source locale.                                             |
| `sourceLocale` | `string`   | `"en"`   | The locale your source is written in. Never written to disk — the compiler already has those strings. |

## Where files go

| Option          | Type                        | Default                         | What it does                                                                     |
| :-------------- | :-------------------------- | :------------------------------ | :------------------------------------------------------------------------------- |
| `outputDir`     | `string`                    | `"./zintl"`                     | Where catalogs are written, relative to the project root.                        |
| `catalogFormat` | `string \| (ctx) => string` | `<path>[.<func>].<locale>.json` | Catalog file naming. Tokens: `[locale] [path] [dir] [name] [func] [bId] [hash]`. |
| `metadataDir`   | `string`                    | `<root>/node_modules/.zintl`    | Where the compiler keeps its own bookkeeping. Not something you edit.            |

## Content beyond code

| Option          | Type                              | Default         | What it does                                                                                                                                                           |
| :-------------- | :-------------------------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetsTarget`  | `(string \| AssetTargetConfig)[]` | `["md", "txt"]` | Static content files to localize alongside code. A bare extension is shorthand for `**/*.<ext>`.                                                                       |
| `virtualAssets` | `boolean`                         | `false`         | Serve localized assets from virtual modules instead of writing them to disk. Keeps the working tree clean, at the cost of not being able to edit the output as a file. |

## Catalog upkeep

| Option                | Type      | Default                         | What it does                                                                                                                 |
| :-------------------- | :-------- | :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `prune`               | `boolean` | `true`                          | Remove catalog keys once no source string produces them.                                                                     |
| `similarityThreshold` | `number`  | `0.6`                           | How similar an edited string must be to keep its existing translation. Lower is more forgiving.                              |
| `verifyIntegrity`     | `boolean` | `true` on build, `false` on dev | Verify catalogs against the manifest. **This is what makes a missing translation fail your build rather than render blank.** |

`verifyIntegrity` is worth understanding before you turn it off. Zintl has no fallback to the source locale — by design. A missing translation is a bug, the same way reading an uninitialised variable is a bug, and this is the check that catches it before your users do.

## Build shape

| Option      | Type            | Default        | What it does                                                                                                                                          |
| :---------- | :-------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facets`    | `FacetsInput[]` | `["builtins"]` | Which capabilities the compiler is built with. `"builtins"` puts the built-in facet set on the table; each one decides for itself whether it applies. |
| `multiplex` | `boolean`       | auto-detected  | Build each locale as its own set of HTML entries.                                                                                                     |

`facets` is the extension point. Framework support, SSR handling, asset handling and bundler integration are separate, composable pieces rather than flags on a monolith — which is why adding a framework or a build tool is additive rather than a rewrite. Two facets that claim the same file extension are a hard error, not a silent last-one-wins.

`multiplex` needs a bundler that supports per-locale HTML fan-out — Vite does, [Rsbuild](#rsbuild) does not. Combining `multiplex: true` (explicit or auto-detected) with an unsupported bundler fails your build with a clear error rather than an opaque one.

### Facets decide for themselves

`"builtins"` does not mean "guess what I need". It means _offer the built-in facets as candidates_ — each one then answers whether it applies, from its own declaration. The React facets ask for React, the SSR facets ask for an SSR build, the Vite facet asks whether Vite is the host.

So the list is additive, and adding your own facet does not disturb that:

```ts
zintl({ facets: ["builtins", myMarkdownFacet()] }); // the built-in set, plus yours
zintl({ facets: [reactFacet(), ssrFacet()] }); // exactly these, nothing implicit
```

Omitting `"builtins"` gives you precisely what you name — with one exception: the bundler facet for your host is always a candidate, because opting out of the built-in set should not silently strip the integration that makes the plugin work at all.

To keep the built-in set but drop one member, name it rather than re-listing everything:

```ts
import { excludeFacet } from "zintljs/facets";

zintl({ facets: ["builtins", excludeFacet("client-spa")] });
```

### Writing a facet

A facet with **no condition is unconditional** — it applies always, with no check performed. That is the right default for a facet you added to your own project, because you added it on purpose.

Declare a condition when a facet should not always apply:

```ts
{
  name: "my-codegen",
  concern: "codegen",
  when: { framework: "react", ssr: false },
  // ...
}
```

`when` accepts `framework`, `bundler`, `dependency`, `ssr` and `dev`. Every field you set must hold; fields you omit are not constraints. For conditions this cannot express there is `activate(ctx)`, but prefer `when` where it fits — see the trace below for why.

A facet can also declare its relationships:

| Field        | Meaning                                                           |
| :----------- | :---------------------------------------------------------------- |
| `provides`   | Capability names other facets can target, e.g. `["ssr:wrapping"]` |
| `supersedes` | Facets this one replaces, by name or by a capability they provide |
| `conflicts`  | Facets this one cannot coexist with — a hard error, not a winner  |
| `priority`   | Which facet wins a single-provider hook. Ties are a hard error    |

`supersedes` exists because activation is not a boolean. The Next.js facets replace the generic SSR and client-SPA facets, and they say so rather than relying on the plugin to know it.

### Why is that facet on?

Every activation decision is recorded, including the negative ones — which are the ones you need when something you expected is missing:

```
✓ nextjs-ssr-wrapping   framework=nextjs ✓
✗ ssr-wrapping          superseded by nextjs-ssr-wrapping
✗ client-spa            superseded by nextjs-runtime
✗ vue-extraction        when.framework=vue ✗ (detected: react, nextjs)
```

This is why `when` is data rather than a function: a predicate can only report _that_ it said no, where a descriptor can say which condition failed and what was found instead.

## Rsbuild

Zintl also ships `zintljs/rsbuild`, for projects built with [Rsbuild](https://rsbuild.dev) instead of Vite:

```ts
// rsbuild.config.mjs
import { defineConfig } from "@rsbuild/core";
import zintl from "zintljs/rsbuild";

export default defineConfig({
  plugins: [
    ...zintl({
      locales: ["en", "ar", "fr"],
    }),
  ],
});
```

Every option above applies the same way — `zintljs/rsbuild` is the same plugin behind a different entry point, not a second implementation.

Rsbuild is a supported target in production builds and in `rsbuild dev`, with **React, Vue, Svelte and vanilla JavaScript**, for **single-page apps** and for **ordinary multi-page apps** (several `source.entry` keys, several HTML templates). Chunk-aligned catalogs — including routes behind `await import()` — ghost mode, localized assets, per-locale `<html lang>`/`dir` and dev-time string edits all carry over from the Vite integration, with no Rspack-specific code in the compiler. Every configuration named here is driven by the test suite.

Vue's Options API works — a component written with a plain `<script>` needs no change. Zintl adds a `<script setup>` block beside the one you wrote, carrying only its own imports and matching your block's `lang`; Vue compiles the two together, so your `export default { data, methods }` stays exactly as written and your template can reach the helpers. Three shapes cannot take that extra block and fail the build with a clear message instead of rendering an empty page: a `<script src="…">`, a `<script lang>` that is not JavaScript or TypeScript, and a component that already declares its own `setup` option. Convert those to `<script setup>`.

**How a dev edit arrives differs by app, and it is worth knowing which you have.** In a framework app whose components re-read the catalog the edit applies in place, with no page reload. In an app with no such components the page reloads instead. That is deliberate rather than a limitation: on Rspack a re-executed entry reads its imports from the module cache, so an app whose only repaint is re-running its entry could otherwise re-seed itself from a stale catalog and render empty strings. Declining the update and reloading is slower and correct. Today React is the framework that supplies the in-place path; Svelte and plain JavaScript get the reload.

One consequence of the reload, measured rather than predicted: if the edited string lives in a boundary the runtime has to **fetch** — a component, a lazy route — the reload can outrun the catalog write, so the page paints empty before it paints the new text. A string in the entry's own boundary does not have that gap, because the manager inlines that catalog for the active locale.

Two things are not supported:

| Not supported | What happens                                                                                                                                                                                                                                                  |
| :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `multiplex`   | Fails the build immediately with a clear error rather than silently doing nothing. The per-locale HTML fan-out `multiplex` builds is Vite-only and is **not** planned for Rspack. Ordinary multi-page apps, where the locale is chosen at runtime, work fine. |
| SSR           | Unbuilt and unexamined. There is no Rsbuild SSR path to route to yet.                                                                                                                                                                                         |

Install `@rsbuild/core` yourself — it is an optional peer dependency, tested against `^2.1.0`.

Seven examples cover the supported ground, and between them the two dev behaviours above: [`rsbuild-vanilla-basic`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-vanilla-basic) (plain JavaScript, localized `.txt` asset), [`rsbuild-react-basic`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-react-basic) (in-place hot updates), [`rsbuild-vue-basic`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-vue-basic), [`rsbuild-svelte-basic`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-svelte-basic), [`rsbuild-vanilla-spa`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-vanilla-spa) and [`rsbuild-vue-spa`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-vue-spa) (client routers, lazy catalogs), and [`rsbuild-vanilla-mpa`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-vanilla-mpa) / [`rsbuild-vue-mpa`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-vue-mpa) (two documents, shared self-anchoring header). See `docs/spec/proposals/026`–`030` for how each of these was established.

## Next.js via vinext

Zintl has Next.js facets, and it is worth being exact about what they cover: **[vinext](https://github.com/cloudflare/vinext)**, which runs a Next.js app on Vite. They are not Next.js support in general.

The facets wrap `virtual:vinext-rsc-entry`, `virtual:vinext-server-entry` and `virtual:vinext-app-ssr-entry` for per-request locale scoping, suppress `metadata` / `viewport` / `generateMetadata` / `generateViewport` from extraction (build-time exports, not UI), and declare `serverComponents: true` so hooks are only injected where `"use client"` allows them. All three bind to vinext's entries, so a Next.js build on webpack or Turbopack has nothing for them to attach to.

Detection is gated on `vinext` for that reason — a bare `next` in `package.json` does not activate them. That gate is not cosmetic: `nextjs-runtime` declares `supersedes: ["ssr-runtime", "client-spa"]`, so a false positive used to strip client locale sync from any Vite SPA that merely had `next` somewhere in its dependency tree.

**Status: experimental.** [`examples/vinext-basic`](https://github.com/zintljs/zintl/tree/main/examples/vinext-basic) builds and runs, but unlike every other example it is **not** in the contract manifest — no browser test drives it on each change. Treat it as a working starting point, not as a tested target, and please report what breaks.

**Next.js on webpack or Turbopack is not planned.** Turbopack has no public plugin API ([proposal 026](https://github.com/zintljs/zintl/blob/main/docs/spec/proposals/026-rsbuild-as-falsification-harness.md) records this), and building on webpack means building on the bundler Next.js is moving away from. If you need i18n on stock Next.js today, Zintl is not the tool.

## Unsupported hosts

Zintl integrates through a facet whose `concern` is `"bundler"`, and exactly one activates per build. On a host where none does — webpack, Rollup, esbuild, Farm — the plugin **refuses to build**:

```
[Zintl] Unsupported build tool: "webpack".

No bundler facet claims it, so Zintl cannot resolve its virtual modules or align
catalogs with your chunks. It stops here rather than building something wrong.
```

That is deliberate. Virtual module resolution, the dynamic-import shape and HMR acceptance all come from the bundler facet; with none active they each fall back to a Vite-shaped default the host does not honour, so the build produces output and the output is wrong. Refusing is the kinder failure.

The check asks the facet system rather than an allowlist, so contributing a bundler facet through `facets` lifts it — see [Writing a facet](#writing-a-facet).

**Vite-based meta-frameworks are a different case.** Nuxt, SvelteKit, Astro, Remix and TanStack Start all report Vite as the host, so the plugin loads and this fence never fires. Nothing about their routing or SSR entry shapes is modelled or tested. They are unexplored, not supported — and unlike the hosts above, nothing will tell you so at build time.

## Output

| Option     | Type                | Default                          | What it does                                        |
| :--------- | :------------------ | :------------------------------- | :-------------------------------------------------- |
| `debug`    | `boolean \| string` | `false`                          | Verbose tracing. A string filters to one subsystem. |
| `logLevel` | `LogLevel`          | Vite's `logLevel`, then `"info"` | How much Zintl prints.                              |

In the browser, set `globalThis.__ZINTL_DEBUG = true` before your app boots to see runtime tracing in the console.
