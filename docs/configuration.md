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

| Option      | Type            | Default       | What it does                                                                                                              |
| :---------- | :-------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------ |
| `facets`    | `FacetsInput[]` | `["auto"]`    | Which capabilities the compiler is built with. `"auto"` detects your framework from your Vite plugins and `package.json`. |
| `multiplex` | `boolean`       | auto-detected | Build each locale as its own set of HTML entries.                                                                         |

`facets` is the extension point. Framework support, SSR handling, asset handling, and bundler integration are separate, composable pieces rather than flags on a monolith — which is why adding a framework or a build tool is additive rather than a rewrite. Listing facets without `"auto"` opts out of detection and gives you exactly what you name. Two facets that claim the same file extension are a hard error, not a silent last-one-wins.

## Output

| Option     | Type                | Default                          | What it does                                        |
| :--------- | :------------------ | :------------------------------- | :-------------------------------------------------- |
| `debug`    | `boolean \| string` | `false`                          | Verbose tracing. A string filters to one subsystem. |
| `logLevel` | `LogLevel`          | Vite's `logLevel`, then `"info"` | How much Zintl prints.                              |

In the browser, set `globalThis.__ZINTL_DEBUG = true` before your app boots to see runtime tracing in the console.
