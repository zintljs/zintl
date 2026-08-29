# What is Zintl

Zintl is a compile-time internationalization engine. You write ordinary strings; the compiler finds them, works out which ones each screen actually needs, and ships exactly those.

## The whole API

```ts
import { zintl } from "zintljs/macro";

await zintl(userLocale);

document.querySelector("#app").innerHTML = `<h1>Welcome back!</h1>`;
```

That is not an excerpt. There is no `t()` to wrap the heading in, no key to invent for it, and no dictionary to keep in sync by hand.

## Why that is possible

Most i18n libraries run at runtime, so they have to be told which strings exist — and the only way to tell them is to mark every one at its call site. Zintl reads your source with a parser before your app runs. Which strings exist, and which screen can reach them, are both facts it can work out at build time.

Once you have those two facts, translation stops being a lookup problem and becomes a **bundling** problem. That reframing is where the rest of Zintl comes from.

## What falls out of it

**Your translations split the way your code splits.** A call to `zintl(locale)` marks a _trust anchor_ — the point your app decides what language it is in. Everything reachable from that anchor becomes a _boundary_, and a boundary becomes a catalog chunk. Someone who opens your settings page downloads the settings translations. Not all of them.

**Nothing ships that you do not use.** Plural and gender rules compile to plain JavaScript conditionals, so no grammar engine reaches the browser. Your source language is never written to disk at all — the compiler already has those strings.

**Refactoring is free.** Identity is content-based rather than path-based, so moving a file or renaming a component does not invent new keys. Restructuring an app normally costs a day of reconciling catalogs afterwards. Here it costs nothing.

## What it asks of you in return

A missing translation is a build error, not a fallback.

> [!IMPORTANT]
> Zintl never renders your source language in place of a missing translation. There is no fallback path to switch on, by design — a silent fallback is a bug that reaches your users looking like a feature.

That is the one place Zintl is stricter than what you are probably used to, and it is deliberate: the check that would have caught it runs in your build instead of in production.

## Where to go next

| If you want to                        | Read                                                     |
| :------------------------------------ | :------------------------------------------------------- |
| Install it and see a string translate | [Getting started](/guide/getting-started)                |
| Understand the graph underneath       | [Boundaries and chunks](/concepts/boundaries-and-chunks) |
| Know what is settled and what moves   | [Stability](/reference/stability)                        |

This site is itself built with Zintl, in four languages. The bar at the top of the page switches between them, nothing reloads, and the only catalog your browser has downloaded is the one for the page you are reading.
