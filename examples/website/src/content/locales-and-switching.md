# Locales and switching

What you pass to `zintl()` decides how much of your app is still undecided at build time.

## A variable or a literal

```ts
await zintl(locale); // a variable: the locale is a runtime decision
await zintl("fr"); //  a literal:  the locale is a build-time fact
```

They compile to different applications.

|                                   | `zintl("fr")` | `zintl(locale)` |
| :-------------------------------- | :------------ | :-------------- |
| Catalog chunk emitted             | none          | yes             |
| Other locales built               | no            | yes             |
| Source-language strings in bundle | **absent**    | present         |

Note the last row. With a literal, your English text is not in the output at all. The page does not _fall back_ to English — English was never built.

**Use a literal** when a page is genuinely one language: a per-locale static build, a localized landing page, a route generated once per language.

**Use a variable** the moment a user can change language, or the locale comes from a URL, a cookie, a header, or a preference.

> [!WARNING]
> Getting this backwards is quiet. A literal in an app with a language switcher builds cleanly and then cannot switch, because the other locales were never emitted.

## Switching at runtime

Call the macro again:

```ts
await zintl("ar");
```

The catalog is swapped in place and the store notifies whatever is listening. Whether the screen repaints without a reload is a property of your framework, not of Zintl: a framework whose components re-read the catalog repaints where it stands, and one without that mechanism declines the update and reloads instead. Either way the result is correct.

Zintl sets `lang` and `dir` on the document itself, so right-to-left arrives with the language and you do not need a second stylesheet — write `margin-inline-start` rather than `margin-left` and the layout mirrors.

The active locale is remembered, and read back from the first path segment when your routes carry one (`/ar/guide`). Keep the locale in the URL if you want it shareable.

## One document per language

Where every route is a single language, build them all: the `multiplex` option fans your HTML out to one document per locale, each with that locale baked in and nothing else shipped.

This is the shape to reach for on a marketing site or a documentation site that does not need an in-page switcher. It is Vite-only today — Rsbuild has no fan-out.

## Standing a language up

A locale you are still translating does not have to break your build or reach your users. `pendingLocales` names the ones being worked on: their catalogs are maintained and checked, and they are not shipped.

That is the honest version of "we're adding Japanese soon" — the strings are real, the file is real, and nobody is served a half-translated page.

## Next

| To                       | Read                                                     |
| :----------------------- | :------------------------------------------------------- |
| Get plurals right        | [Plurals and grammar](/guide/plurals-and-grammar)        |
| See how boundaries split | [Boundaries and chunks](/concepts/boundaries-and-chunks) |
