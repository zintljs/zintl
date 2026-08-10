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

`multiplex` needs a bundler that supports per-locale HTML fan-out — Vite does, [Rsbuild](#rsbuild) does not yet. Combining `multiplex: true` (explicit or auto-detected) with an unsupported bundler fails your build with a clear error rather than an opaque one.

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

**Experimental, not yet a supported target.** Production builds work: chunk-aligned catalogs, ghost mode, localized assets, and per-locale `<html lang>`/`dir` all carry over from the Vite integration with no Rspack-specific code. Known gaps:

| Gap         | What happens                                                                                                                                             |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hot updates | `rsbuild dev` serves and rebuilds, but an edit needs a manual reload — no dev-time delivery mechanism is emitted on this host yet.                       |
| `multiplex` | Fails the build with a clear error rather than silently doing nothing — the per-locale HTML fan-out `multiplex` builds has no Rspack implementation yet. |
| SSR         | Untouched, unexamined.                                                                                                                                   |

See [`examples/rsbuild-spa`](https://github.com/zintljs/zintl/tree/main/examples/rsbuild-spa) for a working app, and `docs/spec/proposals/026`–`028` for the history and open items behind each gap above.

## Output

| Option     | Type                | Default                          | What it does                                        |
| :--------- | :------------------ | :------------------------------- | :-------------------------------------------------- |
| `debug`    | `boolean \| string` | `false`                          | Verbose tracing. A string filters to one subsystem. |
| `logLevel` | `LogLevel`          | Vite's `logLevel`, then `"info"` | How much Zintl prints.                              |

In the browser, set `globalThis.__ZINTL_DEBUG = true` before your app boots to see runtime tracing in the console.
