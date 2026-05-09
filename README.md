# Vite+ Monorepo Starter

A starter for creating a Vite+ monorepo.

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run test -r
```

- Build the monorepo:

```bash
vp run build -r
```

- Run the development server:

```bash
vp run dev
```

Today we will work on the HTML support! This is a big feature!
Before we start working on this, I want to make sure we have a solid plan.
Lets discuss the architecture!

Now, lets visit these facts!
"""

- In modern Vite/web apps, multiple HTML files are usually entry points, not internal application resources.

- The main `index.html` is the root of the appshell; it defines what actually renders in the browser viewport.

- Secondary HTML files (admin.html, landing.html, etc.) are treated as entirely separate "mini-apps" by Vite, which configured by `vite.config.ts` via `build.rollupOptions.input`.

- They have their own module graphs, their own entry points, and can be served independently.
  """

Currently, wee are at the point where if we keep treating HTML as “just another translatable file,” the architecture will get muddy fast. I believe that HTML is not a normal catalog participant. It’s infrastructure-facing locale projection. What we are really designing is not “HTML translation.”
It’s an HTML projection layer (think of it as config files basically but in a catalog flavored way, where the user feel like what he is doing is configuring but, without a full seperation from the concept of catalogs). That distinction matters because it gives you a clean boundary and stops feature creep.

⸻

First: simplify the mental model

Before we started working on this, we got lost because we kept drifting into runtime mechanics. Thus, we need to strip it down.

There are only 3 concerns here:

1. Extraction

What configurable values exist in HTML?

Example:

```
<html>
<head>
  <title>My App</title>
  <meta name="description" content="Hello">
</head>
</html>
```

Extractable config surface:

```
{
"title": "My App",
"description": "Hello"
}
```

Not “translations.”

These are locale projections.

⸻

2. Resolution

For locale ar, what should each projection become?

Some are explicit:

```
{
"title": "تطبيقي"
}
```

Some are computed:

```
{
"dir": "rtl"
}
```

Some fallback to source HTML.

⸻

3. Application ( Transformation )

How do we apply it?

Either:

- Bake into HTML
- Inject runtime resolver

Determined by the main entry anchor.

That’s it.

Not multiplexing, not shadow-vassals, not sovereign diplomacy 😄
(save the mythology for docs later).

Right now we need a strict implementation contract.

⸻

The architecture we want

Core principle

HTML participates in locale generation through a Synthetic Projection Catalog

Not:

- virtual catalog
- regular catalog
- extracted module

It is its own category.

Call it:

HtmlProjection

⸻

Internal representation

Inside compiler:

```
type HtmlProjection = {
id: string
owner: ModuleId
mode: "baked" | "runtime"
source: HtmlSnapshot
schema: HtmlProjectionSchema
}
```

Where:

schema

```
type HtmlProjectionSchema = {
title?: string
description?: string
dir: Resolver
}
```

dir always exists, even if absent in source. thats because dir is very important in i18n, just like `lang` but lang we can resolve it automatically from the locale inside the system and we do not want to bother the user with it, but dir we cant unliss we track all locale that uses rtl staticaly which is against our philosophy.

⸻

Disk catalog format

should look like configuring something rather than translating

`index.ar.json`:

```json
{
  "$schema": ".schemas/index.schema.json",
  "title": "تطبيقي",
  "description": "منصة حديثة",
  "dir": "rtl"
}
```

This feels declarative. Like environment configuration.

⸻

Extraction rules

Here we need to automatically detect the HTML surface that needs to be extracted. this is becuse our system is mentally prepared for this from the start. The user/dev start building the app for the source locale, then the Zintl system detecte all the translatable strings. Now on that stage the idea of locale projection is normal to the user, it symbioses with the normal behavior of the Zintl and the app itself.

So, for the HTML surface, we need to automatically detect the HTML surface that needs to be extracted. But we need to be careful not to over-engineer this feature. lets start with a set of fixed HTML surface and we can extend it later or even make it controlable by the user. now lets make it simple for the first version, we will support only the following HTML surface:

Supported:

- dir
- title
- description

⸻

Missing values behavior

Normal catalogs:

missing => build error

HTML projection:

missing => fallback to source! (if no source fallback to computed resolver, or empty string for string values)

Priority:

1. disk catalog
2. source html
3. computed resolver

For dir, source probably absent then compute.

⸻

The ownership rule

This needs to be brutally simple.

If HTML has multiple module scripts, choose:

Rule:

The big zintlied one is the winer! like if there are two module scripts one uses dynamic anchor and another uses static anchor, then the dynamic one is the winer! since it would work for both modules!
However, we should not name this as an ownership! every anchors is completly independent and should be treated as a seperate entity! so this is just a simple selection mecanisim based on compability, **not** ownership!

However, if multiple modules with deferent static anchors are found, the html anchore will uses the first one found and set its anchor type and locale based on it!

Moreover, if the html file does not have any anchor in its module! then no extraction no schema/catalog generation and no transformation! it's like if an entry main that does not uses zintl() at all!

⸻

Runtime vs baked

This is where everything clicks.

Determine from owner anchor.

Static

zintl("ar")

Result:

bake HTML

Output:

<html lang="ar" dir="rtl">
<title>...</title>

No runtime script.

⸻

Dynamic

zintl(locale)

Result:

inject resolver bootstrap

Because HTML must track runtime locale.

⸻

The bootstrap should stay tiny when possible! like defaulting or resolver should have no runtime cost.
For HTML projection, speed comes from zero negotiation! instead of negotiation like we do in module anchors we will use a simple state injection. The HTML should already contain everything needed, and the application should use it directly. That means the resolver must run: before first paint and before main module executes.
So the ideal shape is: Inline blocking script in `<head>`, and placed before module scripts.

```html
<script>
  (function () {
    // get locale from localStorage, need to cordenite with runtime and see what we can use here!
    const l = localStorage.getItem("zintl-locale") || "en";

    function apply(l) {
      if (document.documentElement.lang === l) return; // Optimization! no double work! in first load from runtime!

      // dir, added only if one or more locale uses dir: rtl. in our case only one locale ["ar"]
      if (["ar"].includes(l)) {
        document.documentElement.dir = "rtl";
      } // automatically ltr otherwise!

      // lang is set manually
      document.documentElement.lang = l;

      // Store only differences from source locale. without dir
      const D = {
        ar: {
          title: "تطبيقي",
          description: "منصة حديثة",
        },
        fr: {
          title: "Mon application",
        },
        // ... add more as needed
      };
      const delta = D[l];
      if (delta) {
        if (delta.title !== undefined) {
          document.title = delta.title;
        }
        if (delta.description !== undefined) {
          const meta = document.querySelector('meta[name="description"]');
          if (meta) {
            meta.content = delta.description;
          }
        }
        // ... add more as needed
      }
    }

    // make apply function available for the runtime! and we can change it later using runtime.
    window.__zintlApplyHtml = apply;

    // if source locale ("en" in our example) no need to apply anything
    if (l !== "en") {
      apply(l);
    }
  })();
</script>
```

Then runtime can use it to change locale on demand:

```
window.__zintlApplyHtml(locale)
```

No handshake!
No protocol!
No runtime negotiation/dependency!
No coordination!
Zero async!
Simple injection only for
Just deterministic projection applied before main JavaScript runs.

⸻

Build pipeline

This is probably the feature breakdown we need.

Phase 1 — Extract

During scan:

index.html
-> parse
-> collect projection keys
-> link owner module, but we need to make sure that it does not enter the owner kingdom and it does not affect the owner anchor!

⸻

Phase 2 — Generate disk projections

For each locale except ghost/source:

Generate:

.schemas/index.schema.json
index.ar.json
index.en.json

(or whatever our disk convention is! i want to refer to `catalogFormat` config! but i am a little worry about getting lost here!)

⸻

Phase 3 — Resolve

Merge:

- source defaults
- disk overrides
- computed resolvers

⸻

Phase 4 — Transform

In transformIndexHtml

Apply resolved values.

Static:
direct mutate

Dynamic:
inject bootstrap + runtime script

⸻

Critical thing to avoid

Don’t let HTML enter the normal catalog dependency graph.

That would poison the model.

HTML should attach to module ownership as metadata:

ModuleNode
-> htmlProjection?: HtmlProjection

Not:

CatalogGraphNode

This is the architectural line that keeps the system sane.

⸻

Our strongest insight here was this:

html disk catalogs should feel like config rather than translation! That’s the entire feature philosophy. Build around that, and the implementation becomes much clearer.

---

ok nice! i only has one conceren!

imagine that we have 30+ locale and all locale has not set any thing in the html catalog, then we will has like `"es":{"title":""}` 30 times! while we already fallback to default if there is no es delta!

However if the locale has at leas one key set to a value (other than `dir`) then we should append it in deltas!

Do you aggree?

and also if deltas is actually empty, like `const deltas = {}`

then we do not need to even declare it or add this part:

```
const delta = deltas[locale];
            if (delta) {
              if (delta?.title !== null && delta?.title?.trim() !== "") document.title = delta.title;
              else document.title = originals.title;

              if (delta?.description !== null && delta?.description?.trim() !== "") {
                const meta = document.querySelector('meta[name="description"]');
                if (meta) meta.content = delta.description;
              } else {
                const meta = document.querySelector('meta[name="description"]');
                if (meta && originals.description !== undefined) meta.content = originals.description;
              }
            }
```

all of this would minimize the code and it would be better for zeroing everything not needed!
