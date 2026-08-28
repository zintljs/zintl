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

| Option           | Type       | Default  | What it does                                                                                          |
| :--------------- | :--------- | :------- | :---------------------------------------------------------------------------------------------------- |
| `locales`        | `string[]` | `["en"]` | Every locale your app ships, including the source locale.                                             |
| `sourceLocale`   | `string`   | `"en"`   | The locale your source is written in. Never written to disk — the compiler already has those strings. |
| `pendingLocales` | `string[]` | `[]`     | Locales you are standing up: catalogs are maintained, nothing ships. See below.                       |

## Where files go

| Option          | Type                        | Default                         | What it does                                                                     |
| :-------------- | :-------------------------- | :------------------------------ | :------------------------------------------------------------------------------- |
| `outputDir`     | `string`                    | `"./zintl"`                     | Where catalogs are written, relative to the project root.                        |
| `catalogFormat` | `string \| (ctx) => string` | `<path>[.<func>].<locale>.json` | Catalog file naming. Tokens: `[locale] [path] [dir] [name] [func] [bId] [hash]`. |
| `metadataDir`   | `string`                    | `<root>/node_modules/.zintl`    | Where the compiler keeps its own bookkeeping. Not something you edit.            |

## Content beyond code

| Option          | Type                              | Default         | What it does                                                                                                                                       |
| :-------------- | :-------------------------------- | :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetsTarget`  | `(string \| AssetTargetConfig)[]` | `["md", "txt"]` | Files whose content varies by locale. A bare extension is shorthand for `**/*.<ext>`. Any file type — `.md`, `.pdf`, `.webp`, `.mp4`.              |
| `virtualAssets` | `boolean`                         | `false`         | Deliver localized assets through virtual modules rather than resolving imports straight to the artifact on disk. Artifacts are written either way. |

**A targeted asset is authored per locale, not translated into existence.** Targeting `about.txt`
creates an empty `zintl/src/about.ar.txt` for you to fill — the compiler never copies the English
into it, because an English PDF at the German path is not a German PDF, and a byte-identical file is
a source-locale fallback nothing downstream can detect. An unfilled artifact fails your build under
`verifyIntegrity`, the same way an empty catalog entry does.

If an asset is the same in every locale, do not target it. That is the whole of what targeting means.

How it reaches the browser is decided by your import, not by the file's extension:

```ts
import text from "./about.txt?raw"; // the contents, inlined into the catalog
import url from "./hero.webp"; // the bundler's URL for this locale's artifact
```

Both follow the locale at runtime, so switching language re-points the import
without a reload — a plain import of a targeted asset is not the static binding
it would ordinarily be. Everything else about it is ordinary: the bundler emits
and hashes the per-locale file exactly as it would any asset.

A source edit never touches an artifact, and never warns that one is stale — whether the German
version has fallen behind the English is an editorial question, not one a compiler that can only see
that bytes differ should be answering. Renaming or moving a source _does_ carry its artifacts with
it: identity is content-based here as everywhere else.

### Artifacts and catalogs share one naming scheme

Both are named `<outputDir>/<path>.<locale>.<ext>`, so targeting `.json` — the extension catalogs
themselves use — can put an artifact exactly where a boundary's catalog goes. `assetsTarget:
["json"]` with an asset at `src/data.json` and a boundary in `src/data.ts` gives both
`zintl/src/data.ar.json`.

That build is refused, naming the file, the facet that claimed it and the boundary whose catalog it
is. It is refused rather than resolved because the catalog is written second: the artifact would
become a catalog, `verifyIntegrity` would find a non-empty file and pass, and your asset would ship
in the source language with nothing said.

Only an actual overlap is refused, not the extension. `assetsTarget: ["json"]` is fine when nothing
collides — a differently named source, or a multilingual `catalogFormat` that keeps catalogs out of
the way. When something does collide, give the artifacts their own location:

```ts
assetsTarget: [{ targetPattern: "**/*.json", outputPattern: "assets/[locale]/[dir]/[name].[ext]" }];
```

`outputPattern` is resolved from the project root, not from `outputDir`, and takes `[locale]`,
`[dir]`, `[name]` and `[ext]`.

## Catalog upkeep

| Option                | Type      | Default                         | What it does                                                                                                                   |
| :-------------------- | :-------- | :------------------------------ | :----------------------------------------------------------------------------------------------------------------------------- |
| `prune`               | `boolean` | `true`                          | Remove catalog keys once no source string produces them.                                                                       |
| `similarityThreshold` | `number`  | `0.6`                           | How similar an edited **string** must be to keep its existing translation. Lower is more forgiving. Assets are never compared. |
| `verifyIntegrity`     | `boolean` | `true` on build, `false` on dev | Verify catalogs against the manifest. **This is what makes a missing translation fail your build rather than render blank.**   |

`verifyIntegrity` is worth understanding before you turn it off. Zintl has no fallback to the source locale — by design. A missing translation is a bug, the same way reading an uninitialised variable is a bug, and this is the check that catches it before your users do. It covers localized assets too: an empty artifact is a missing translation with a file for a body.

### When a release cannot wait for a translator

It happens: a string lands on Friday, the translators are back Monday, and the build is red. There is no gentler gate for this, and that is deliberate — every design that lets a build pass with holes ships blank text to real users, which is the thing Zintl exists to prevent.

So the escape hatch is one explicit, temporary decision rather than a permanent setting:

```ts
zintl({ locales: ["en", "ar", "fr"], verifyIntegrity: false });
```

Ship it knowing those strings render empty for anyone on an affected locale, and turn it back on with the translations. Zintl will not make that choice quiet, but it will not make it for you either.

What stops it being a surprise is the status line below — the completeness you have been watching all week is the same number the gate is about to check.

### Standing up a new locale

Adding `de` to `locales` on the day you start translating it means every build fails for the month it takes, because German is 0% done. Turning `verifyIntegrity` off for that month is the wrong tool: it removes the gate from `ar` and `fr` too, and those have real users.

`pendingLocales` is the per-locale version of that decision:

```ts
zintl({
  locales: ["en", "ar", "fr"],
  pendingLocales: ["de"],
});
```

A pending locale is **maintained but not shipped**:

|                             | Pending locale                                                       |
| :-------------------------- | :------------------------------------------------------------------- |
| Extraction                  | Yes — it needs keys                                                  |
| Catalog files written       | Yes — translators need files to fill                                 |
| Reconciliation and pruning  | Yes — it stays in sync as the source changes, and nothing deletes it |
| Status line                 | Yes, marked `(pending)` — progress is the whole point                |
| `verifyIntegrity`           | **Exempt** — incompleteness is the expected state                    |
| Catalog chunk in your build | **No**                                                               |
| Runtime locale list         | **No** — a switcher built from it will not offer German              |
| `zintl("de")`               | **Build error**, naming it as pending rather than as unknown         |

The no-fallback rule is untouched. A locale ships complete or it does not ship — nothing renders blank, because nothing renders in German at all until you promote it.

**Promotion is moving the string into `locales`.** The build gates it from that moment, and the first thing it reports is exactly what is still missing — which by then should be nothing, because the status line has been counting all along.

A locale cannot be in both lists, and `sourceLocale` can never be pending. Both are configuration errors, raised before anything builds.

This does **not** solve the Friday problem above. The locales missing a string added on Friday are `ar` and `fr` — already shipped, with real users — and marking Arabic pending would drop it from the release entirely. That is far worse than a red build. The two situations share a symptom and nothing else.

## Untranslated strings while you work

| Option           | Type      | Default | What it does                                                                                    |
| :--------------- | :-------- | :------ | :---------------------------------------------------------------------------------------------- |
| `pseudoLocalize` | `boolean` | `true`  | While serving, show an untranslated string as `⟦Ẇéļçöṁé ƀàçķ!⟧` rather than as an empty string. |

Catalogs start empty. `verifyIntegrity` is off while serving, and a missing key resolves to `""`, so switching locale on a fresh project used to blank the page — nothing broken, nothing said, the app just emptied.

`pseudoLocalize` replaces that silence with something you can see:

```
⟦Ýöü ĥàṽé 3 ñéẁ ṁéššàĝéš⟧
```

**This is not a fallback to the source locale**, and the distinction is the whole design. The text is deliberately unmistakable — nobody reads that as a translation, and nobody ships it. It lives inside the `__ZINTL_DEV__` guard, so a production build folds the branch away and the transform with it; `verifyIntegrity` still fails that build. What you get is a dev server that tells you what is missing by showing you, and a build that refuses on the same set.

Placeholders and markup are left alone, and the result goes through normal interpolation: `{count}` shows the real count, `<a>` renders as a link. The layout stays honest; only the words announce themselves.

Set it to `false` if you would rather see the empty strings.

### Progress, per locale

Every dev flush prints completeness when it changes:

```
[Zintl/WARN] Translations ar 44/47 · fr 12/47 — 38 missing, a production build will fail until they are filled
[Zintl/INFO] Translations complete — ar 47/47 · fr 47/47
```

Incomplete is a **warning**, not an info, because it is not a status update — it is a build that is going to fail, reported early enough to act on. At `info` it would be the first line to disappear for anyone running `logLevel: "warn"`, who would keep every line they did not care about and lose the one that predicts the failure.

Counted the same way the build gate counts, so the number cannot tell you one thing and CI another. Printed only on change, so a translator saving a catalog is a line you notice rather than one more in a stream.

There is no build-time equivalent, and there is nothing to add: a build either passes at 100% or fails with the full list of what is missing.

`getTranslationStatus()` on the compiler returns the same counts, for a facet or a host integration that wants them without the log.

## Build shape

| Option      | Type            | Default        | What it does                                                                                                                                          |
| :---------- | :-------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facets`    | `FacetsInput[]` | `["builtins"]` | Which capabilities the compiler is built with. `"builtins"` puts the built-in facet set on the table; each one decides for itself whether it applies. |
| `multiplex` | `boolean`       | auto-detected  | Build each locale as its own set of HTML entries.                                                                                                     |

`facets` is the extension point. Framework support, SSR handling, asset handling and bundler integration are separate, composable pieces rather than flags on a monolith — which is why adding a framework or a build tool is additive rather than a rewrite. Two facets that claim the same file extension are a hard error, not a silent last-one-wins.

The same goes the other way: `assetsTarget` and `virtualAssets` configure the _built-in_ assets facet, so replacing or excluding that facet while setting them is a hard error too. Configure your own facet instead — `assetsFacet({ targets: [...] })`.

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

### Naming a built-in reconfigures it

Passing a facet with the same name as a built-in **replaces** that built-in, on either side of the sentinel:

```ts
zintl({ facets: ["builtins", assetsFacet({ targets: ["mdx"] })] }); // yours wins
zintl({ facets: [assetsFacet({ targets: ["mdx"] }), "builtins"] }); // and here too
```

The activation trace records the one that stepped aside, so this is visible rather than assumed:

```
✗ system-static-assets (built-in)   replaced by the "system-static-assets" facet you passed
```

Order does not decide this, and that is deliberate — membership is settled by name and provenance, precedence by `priority`. Neither depends on where in the list a facet was written.

### What counts as a translatable string

Zintl extracts a string when it reaches a **sink target** — a place a string is known to be
user-facing. Targets are declared by facets, so what a project extracts follows from which facets are
active.

The descriptor forms:

| Form                    | Matches                                           | Example                                 |
| :---------------------- | :------------------------------------------------ | :-------------------------------------- |
| `jsx:<element>:<attr>`  | A JSX attribute; `*` for any element              | `jsx:*:alt`, `jsx:html:dir`             |
| `html:attr:<attr>`      | An attribute in HTML or an SFC template           | `html:attr:placeholder`                 |
| `dom:<receiver>:<prop>` | An assignment to a property; `*` for any receiver | `dom:*:innerHTML`, `dom:document:title` |
| `dom:prop:<prop>`       | The original spelling of `dom:*:<prop>`           | `dom:prop:textContent`                  |
| `obj:<binding>:<field>` | A field of an object; `*` for any object          | `obj:*:label`, `obj:ui:title`           |
| `obj:field:<field>`     | The original spelling of `obj:*:<field>`          | `obj:field:label`                       |
| `call:<fn>:<field>`     | A field of an object passed to that call          | `call:defineConfig:title`               |
| `tag:<fn>`              | A tagged template literal holding markup          | `tag:html`                              |

Plain text in HTML documents, SFC templates and JSX children needs no descriptor — it is text in
markup, and that is already the evidence.

**The receiver in `dom:` is what makes a default safe.** `dom:document:title` matches `document.title`
— the browser tab — and nothing else, so `telemetry.title = "signup_click"` is left alone. The
receiver must be a plain identifier: `window.document.title` does not match, deliberately, because
following member chains means guessing again.

The defaults for a plain JavaScript project:

```
tag:html   dom:prop:innerHTML   dom:prop:textContent   dom:prop:innerText   dom:document:title
```

Every one rests on **evidence rather than a guess**. `innerHTML` and its two neighbours are DOM
coinages — nobody names an ordinary field `innerHTML`. `document.title` is qualified by its receiver,
so `telemetry.title` is left alone. And a tagged template is markup because the author wrapped it in
`` html`…` ``, which cannot happen by accident.

There is deliberately **no `obj:field:*` here**. Matching a field name on any object knows nothing
about the object, so `{ label: "signup_click" }` was extracted like any label — and since extraction
rewrites the value, it came back translated at runtime and failed the build until somebody translated
an analytics constant. Name the object instead, with `obj:<binding>:<field>`, `call:<fn>:<field>` or
[`@zintl-target`](directives.md#zintl-target).

**Narrow by naming what the strings belong to.** `obj:ui:title` matches a `title` inside `const ui = …`
and nothing else; `call:defineConfig:title` matches the object passed to `defineConfig(…)`:

```ts
const ui = { home: { title: "Welcome" } }; // obj:ui:title — nested is fine
const mkUi = () => ({ title: "Welcome" }); // obj:mkUi:title — functions too
defineConfig({ title: "My site" }); //        call:defineConfig:title
```

The binding is the nearest one enclosing the object, found by walking outward, so a field several
levels down still belongs to it. It is the **local** name, not an export alias — `const ui = …;
export { ui as strings }` is matched by `obj:ui:title`, because the target describes where the object
is written rather than how the module exposes it. `export default { … }` has no name at all and cannot
be targeted this way; that is what [`@zintl-target`](directives.md#zintl-target) is for.

`obj:` and `call:` are kept apart because _passed to `cfg()`_ and _bound to `cfg`_ are different
relations — one descriptor covering both would make `call:cfg:title` match a `const cfg = { title }`
that has nothing to do with the call.

`*` works in **either** position: `obj:*:title` is any object's `title`, `obj:details:*` is every
field of an object named `details`. The second is what you reach for when the same shape repeats
across components and listing its fields would be busywork.

### Adding a target without losing the rest

`targets` on a facet **replaces** that facet's list. That is right for reconfiguring one and wrong for
_"I want one more"_ — appending a single entry would mean re-listing every default, and that config
falls behind silently the moment the defaults move.

`additionalTargets` adds:

```ts
zintl({
  locales: ["en", "ar"],
  additionalTargets: ["obj:details:*"],
});
```

Everything the active facets detect stays; yours joins it. Use `targets` on a facet when you mean to
_replace_ what that facet contributes, and `additionalTargets` when you mean to extend.

### Changing what is extracted

To _replace_ what a facet contributes, pass its `targets` a full list — it replaces rather than
appends. (To extend instead, use `additionalTargets` above.)

```ts
import { vanillaFacet } from "zintljs/facets";

zintl({
  facets: [
    "builtins",
    vanillaFacet({
      targets: [
        "dom:prop:innerHTML",
        "dom:prop:textContent",
        "dom:document:title",
        "obj:ui:title", // only objects named `ui`
      ],
    }),
  ],
});
```

Naming a built-in facet replaces it, on either side of the sentinel — see above.

Adding a target widens what your build treats as user-facing. A string that should never have been
translated is not only a wrong catalog entry: because extraction rewrites the value, it comes back
translated at runtime, and because there is no fallback it also fails the build until someone
translates it. `@zintl-ignore` opts a single site back out, and `t()` remains available for anything
the targets cannot express.

### Handing strings to a translation system

Catalogs are JSON because JSON is what a human edits next to the code, where the call site is a click away. Handed to a translator with no repo, no screen and no build, `{ "Open": "" }` is close to worthless — they cannot tell whether _Open_ is a verb or an adjective.

`xliffFacet` exports what the boundary graph knows, in a format every TMS ingests:

```ts
import { xliffFacet } from "zintljs/facets";

zintl({
  locales: ["en", "ar"],
  facets: ["builtins", xliffFacet({ outDir: "./l10n" })],
});
```

A production build then writes `l10n/<locale>.xlf` per locale. **Nothing is written while serving** — an export is a batch act, not a live sync — and your repo never gains an XML file unless you add this facet.

What each string carries, all of it derived rather than typed, so none of it can go stale:

```xml
<unit id="c711797a">
  <notes>
    <note category="zintl:note">Shown after a successful payment</note>
    <note category="zintl:element">Appears as: h1</note>
    <note category="zintl:screens">Appears on: src/Checkout.tsx</note>
    <note category="zintl:placeholder">{user_firstName} is user.firstName</note>
  </notes>
  <segment state="initial">
    <source>Welcome back, {user_firstName}!</source>
    <target></target>
  </segment>
</unit>
```

Two things there are worth calling out, because no translation system can work them out for itself.

**A shared string is exported once, and says so.** If the same words appear in four places, a translator gets one unit and a note saying one translation covers all four. That is the difference between a safe edit and a regression, and it is knowable only from the import graph.

**A carry-forward arrives pre-filled and flagged.** When you edit a source string, Zintl reconciles first and the export _states the answer_ — the old translation, the similarity, and a warning when a whole word changed. Your TMS's own fuzzy matching never gets a turn, which matters because two translation memories guessing independently disagree in ways that are miserable to debug: neither side is malfunctioning.

A pending locale ([above](#standing-up-a-new-locale)) is exported too. It is exactly the locale a translation system is working through.

#### Taking them back

The same facet reads the files back on the next production build. Import is a **gate, not a merge** — everything arriving is a proposal from a system Zintl does not control, and three things happen to it before a catalog sees it.

**Only an approved translation is imported.** XLIFF's `reviewed` and `final` count; `translated` and `initial` are skipped, because they are drafts a reviewer has not signed off. That keeps `verifyIntegrity` meaning exactly one thing: a locale that passes is a locale that is done.

**A corrupt translation fails the build**, in one report, with nothing written:

```
[Zintl Import Error] 2 translations would render incorrectly, across 1 locale.

These came back from an import, so the catalogs on disk are untouched —
nothing here has been written. Fix them at the source and import again.

  ar — 2 refused
      "Welcome back, {name}!"
        {name} is missing from the translation — the value would render with a gap where it should appear
      "{count, plural, one {# item} other {# items}}"
        {count} is missing the few, many, two, zero forms that "ar" requires — those counts would fall through to "other"
```

That second one is worth dwelling on. Arabic has six plural categories and English has two, so a translator working from an English source sees two boxes to fill. A translation system that round-trips the English shape produces a message that silently renders the wrong form for four of them, and nothing anywhere would have told you.

**A string your source no longer has is skipped, not fatal.** Your translation system will always have older data than your repo; failing on that would mean every source edit breaks the next import.

An imported translation overwrites a local catalog value and says so in the build log, with both values. The reviewed answer wins — round-tripping it is the point — and the old value survives in the hive, which is append-only.

The reader handles plain-text segments, which is what Zintl writes. If your system returns XLIFF inline elements (`<pc>`, `<ph>`) it refuses those units by name rather than guessing at them — a gate that guesses is not a gate.

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
