---
"@zintljs/extractor": patch
---

Stop extracting a bound attribute's expression as if it were text.

`ATTRIBUTE_PAIR` opens with `\b`, and a colon is not a word character — so `:title="heading"` matched
from the `t`, giving the attribute name `title` and the value `heading`. Indistinguishable from
`title="heading"`, and treated as such.

The consequences ran in both directions. The _identifier_ went into every catalog as a translatable
string, so translators were asked to translate `heading`. And because extraction rewrites what it
extracts, the binding came back as

```
title: _t("heading")
```

— the translation of a variable's name, in place of the variable. `:title`, `:alt`, `:placeholder`
and `:label` bound to a value are ordinary Vue, so this reached anything written that way.

Bound attributes are now skipped by looking at the character _before_ the match, which is what
distinguishes the shorthand from a namespaced attribute: `xlink:href` matches from its own first
letter with a space before it, and is unaffected. The `v-bind:` spelling needed nothing — it matches
whole and is not a name any facet declares.

Literal attributes are untouched, and so is every project in the suite: 386 contract tests pass with
no snapshot movement, which says no example was relying on the old behaviour.

Found while building the documentation site's landing page, where a `:label` on a code sample turned
a filename into a catalog entry.
