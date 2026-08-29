---
"@zintljs/extractor": patch
---

Stop reading a `>` inside a quoted attribute as the end of the tag.

Markup was split on `/(<[^>]+>)/g`, which takes the first `>` it meets. In a template
dialect that is wrong the moment anyone writes a comparison:

```html
<nav v-if="count > 0" class="toc" aria-label="On this page"></nav>
```

The "tag" ended at `count >`, and `0" class="toc" aria-label="On this page">` became **text** —
extracted as a translatable string and, because extraction rewrites what it extracts, replaced by a
`_t(…)` call sitting in the middle of an attribute list. The component then failed to parse at all,
so the symptom was a build error pointing at a line some distance from the actual one.

The split now matches quoted runs as units, and matches comments first so a `>` inside one does not
end it either. It lives in `HTML_TAG_SPLIT_REGEX` — which already existed and which nothing used —
and the five inline copies now go through it.
