# Getting started

Four steps, and the last one is optional.

## Install

```bash
npm install -D zintljs
```

## Add the plugin

```ts
// vite.config.ts
import { defineConfig } from "vite";
import zintl from "zintljs/vite";

export default defineConfig({
  plugins: [zintl({ locales: ["en", "ar", "fr"] })],
});
```

The first locale in the list is your source language unless you say otherwise with `sourceLocale`. It is the language you write in, and the one Zintl never writes to disk.

Using Rsbuild instead? The plugin and its options are the same — note only the spread, since that entry point returns an array:

```ts
// rsbuild.config.ts
import zintl from "zintljs/rsbuild";

export default defineConfig({
  plugins: [...zintl({ locales: ["en", "ar", "fr"] })],
});
```

## Set a locale

Somewhere in your entry, tell Zintl what language this is:

```ts
// src/main.ts
import { zintl } from "zintljs/macro";

const locale = new URLSearchParams(location.search).get("lang") ?? "en";
await zintl(locale);
```

That call is a **trust anchor**. Everything reachable from it becomes one catalog, and it is the only Zintl API most projects ever touch.

> [!IMPORTANT]
> Pass a variable if the user can change language. `zintl("fr")` is a build-time fact, not a default — the compiler bakes French in and never builds the others, so a language switcher would render, click, and do nothing.

## Run it

Start your dev server and write an ordinary string:

```ts
document.querySelector("#app").innerHTML = `<h1>Welcome back!</h1>`;
```

Zintl extracts it and writes a file per target locale under `zintl/`:

```json
{
  "Welcome back!": ""
}
```

Fill in the empty values. That is the whole workflow — the English side is never written down, because the compiler already has it.

## What happens when you forget one

Your build fails, naming the string and the locale.

That is deliberate and it is the one thing to understand before going further: Zintl has no fallback to your source language, so a missing translation cannot reach a user disguised as English text. If you would rather see the failure in the browser than in CI, `verifyIntegrity` controls it — but the default is the one that catches it earlier.

## Next

| To                                | Read                                                  |
| :-------------------------------- | :---------------------------------------------------- |
| Fill and maintain catalogs        | [Translating](/guide/translating)                     |
| Ship one language, or all of them | [Locales and switching](/guide/locales-and-switching) |
| Get plurals right                 | [Plurals and grammar](/guide/plurals-and-grammar)     |
