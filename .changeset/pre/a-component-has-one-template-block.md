---
"@zintljs/compiler": patch
---

Read the whole of a Vue component past a nested `<template>`.

The SFC template block was matched non-greedily, so it ended at the _first_ `</template>`. Vue's own
control flow nests template elements:

```html
<template>
  <template v-if="ready">…</template>
  <template v-else>…</template>
</template>
```

Everything after that first branch — the other branch, and the rest of the component under it — was
invisible to extraction. The failure was silent rather than loud: the file reported zero messages,
was transformed not at all, and its strings rendered in the source language in every locale. A page
component that branches on whether its content loaded is an ordinary shape, and this is what it did.

Greedy now, because a component has exactly **one** template block — unlike `<script>`, of which it
may have two, and `<style>`, of which it may have several; those two stay non-greedy and the
docblock says why. The opening tag's attribute list is quote-aware for the same reason
`HTML_TAG_SPLIT_REGEX` is.
