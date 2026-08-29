# Configuration

Every option, what it changes, and when you would reach for it.

## Languages

| Option           | Type       | Default            | What it does                                      |
| :--------------- | :--------- | :----------------- | :------------------------------------------------ |
| `locales`        | `string[]` | —                  | Every language this project builds. Required.     |
| `sourceLocale`   | `string`   | first of `locales` | The language you write in. Never written to disk. |
| `pendingLocales` | `string[]` | `[]`               | Maintained and verified, but not shipped.         |

## Where things go

| Option          | Type                        | Default                         | What it does                                                                |
| :-------------- | :-------------------------- | :------------------------------ | :-------------------------------------------------------------------------- |
| `outputDir`     | `string`                    | `"./zintl"`                     | Where catalogs are written, from the project root.                          |
| `catalogFormat` | `string \| (ctx) => string` | `<path>[.<func>].<locale>.json` | Catalog naming. Tokens: `[locale] [path] [dir] [name] [func] [bId] [hash]`. |
| `metadataDir`   | `string`                    | `node_modules/.zintl`           | The compiler's own bookkeeping. Not something you edit.                     |

## Content beyond code

| Option          | Type                              | Default         | What it does                                                                                            |
| :-------------- | :-------------------------------- | :-------------- | :------------------------------------------------------------------------------------------------------ |
| `assetsTarget`  | `(string \| AssetTargetConfig)[]` | `["md", "txt"]` | Files whose content varies by language. A bare extension means `**/*.<ext>`.                            |
| `virtualAssets` | `boolean`                         | `false`         | Deliver localized assets through virtual modules rather than resolving imports to the artifact on disk. |

A targeted asset is **authored** per locale, not translated into existence. If a file is the same in every language, do not target it.

How it reaches the browser follows your import, not the extension:

```ts
import text from "./about.txt?raw"; // the contents, inlined into the catalog
import url from "./hero.webp"; // the bundler's URL for this locale's artifact
```

Both follow the locale at runtime, so switching language re-points the import without a reload.

## Upkeep

| Option                | Type      | Default                         | What it does                                                                           |
| :-------------------- | :-------- | :------------------------------ | :------------------------------------------------------------------------------------- |
| `prune`               | `boolean` | `true`                          | Remove catalog keys once no source string produces them.                               |
| `similarityThreshold` | `number`  | `0.6`                           | How similar an edited string must be to keep its translation. Lower is more forgiving. |
| `verifyIntegrity`     | `boolean` | `true` on build, `false` on dev | Fail the build on a missing translation.                                               |

> [!IMPORTANT]
> `verifyIntegrity` is what makes a missing translation fail your build rather than render blank. Zintl has no fallback to the source language by design — this is the check that catches the gap before your users do. It covers localized assets too: an empty artifact is a missing translation with a file for a body.

## What counts as a translatable string

A string is extracted when it reaches a **sink** — a place a string is known to be user-facing. Sinks are declared by facets, so what your project extracts follows from which facets are active.

| Form                    | Matches                                  |
| :---------------------- | :--------------------------------------- |
| `jsx:<element>:<attr>`  | A JSX attribute; `*` for any element     |
| `html:attr:<attr>`      | An attribute in HTML or an SFC template  |
| `dom:<receiver>:<prop>` | An assignment to a property              |
| `obj:<binding>:<field>` | A field of a named object                |
| `call:<fn>:<field>`     | A field of an object passed to that call |
| `tag:<fn>`              | A tagged template literal holding markup |

Plain text in HTML, SFC templates and JSX children needs no descriptor — it is text in markup, and that is already the evidence.

There is deliberately **no `obj:field:*`** default. Matching a field name on any object knows nothing about the object, so `{ label: "signup_click" }` was extracted like any label. Name the object instead:

```ts
const ui = { home: { title: "Welcome" } }; // obj:ui:title
defineConfig({ title: "My site" }); //        call:defineConfig:title
```

Use `additionalTargets` to add to what the active facets already find, and a facet's own `targets` to replace what that facet contributes.

## Extending it

| Option              | Type                  | What it does                                      |
| :------------------ | :-------------------- | :------------------------------------------------ |
| `facets`            | `(string \| Facet)[]` | Compose framework, bundler and content behaviour. |
| `additionalTargets` | `string[]`            | Add sink descriptors without replacing any.       |
| `multiplex`         | `boolean`             | One HTML document per locale. Vite only.          |
| `debug`             | `string`              | Trace a compiler subsystem.                       |

Configuring an option that belongs to a facet you replaced is a hard error rather than a setting that quietly does nothing.

## Next

| To               | Read                                                |
| :--------------- | :-------------------------------------------------- |
| Steer extraction | [Comment directives](/reference/comment-directives) |
| Check your host  | [Integrations](/reference/integrations)             |
