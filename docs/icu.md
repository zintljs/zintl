# Plurals & grammar

One string in your source has to become correct grammar in every language you ship. Zintl's answer: **your source stays simple, and grammar lives in the catalog.**

## The idea

Write the plain thing:

```ts
const msg = `You have ${count} items in your cart`;
```

English needs one form here (near enough). Arabic needs several. Polish has different rules again. None of that belongs in your component — so it goes in the translation file, where the person who knows the language is working:

```json
{
  "$schema": "./.schemas/main.schema.json",
  "You have {count} items in your cart": "{count, plural, =0 {سلتك فارغة} one {لديك عنصر واحد في سلتك} other {لديك {count} عناصر في سلتك}}"
}
```

That's standard [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/), and the generated `$schema` gives translators autocomplete and validation in their editor.

## What ships

Nothing about that syntax reaches your users. At build time Zintl compiles it into plain JavaScript:

```js
(params) => {
  const { count } = params;
  if (count === 0) return `سلتك فارغة`;
  if (count === 1) return `لديك عنصر واحد في سلتك`;
  return `لديك ${count} عناصر في سلتك`;
};
```

No ICU parser in the bundle, no runtime message parsing — a function call and a couple of comparisons.

## Why the source stays plain

The tempting alternative is to write the grammar inline, in English, so every language has hooks to attach to. That trade is bad in both directions: your source gets harder to read for the language it's actually written in, and you still can't anticipate distinctions that only exist in languages you don't speak.

Keeping source plain means the English reads like English, and each translation carries exactly the complexity its own language requires — no more, no less.

When a target language needs a value your source never mentions — gender, formality, role — pass it explicitly with [`@zintl-pass`](directives.md#zintl-pass).

## A note on empty strings

Zintl never falls back to the source locale. A missing translation is not "show English instead" — it's a bug, in the same way that reading an uninitialised variable is a bug. `verifyIntegrity` catches it at build time, before it can render as a blank space in front of a user.
