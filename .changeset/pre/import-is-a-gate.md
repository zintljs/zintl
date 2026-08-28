---
"@zintljs/compiler": minor
---

Take translations back from XLIFF, and refuse the ones that would render wrong.

`xliffFacet` now reads its own files back on a production build. Import is a **gate, not a merge** —
everything arriving is a proposal from a system Zintl does not control, and until now catalog values
had no validation at all. That was defensible while catalogs were hand-edited beside the code by
someone who could see what they broke; it stops being defensible the moment they round-trip through a
system that hands translators raw ICU syntax, which is most of them.

**Only an approved translation is imported.** XLIFF's `reviewed` and `final` count; `translated` and
`initial` do not, because they are drafts a reviewer has not signed off. That is what keeps
`verifyIntegrity` meaning exactly one thing — a locale that passes is a locale that is done.

**A corrupt translation fails the build**, in one batched report, with nothing written:

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

Four checks, each from material the compiler already has: a dropped or invented placeholder, markup
that no longer matches the source, ICU that no longer parses, and plural categories wrong for the
target language. The last is the one worth having. Arabic has six categories and English has two, so
a translator working from an English source sees two boxes to fill — and a system that round-trips
the English shape produces a message that silently renders the wrong form for four of them.
`Intl.PluralRules` answers that for free and cannot drift from the rules the baked output uses.

**A string your source no longer has is skipped, not fatal.** Your translation system will always
have older data than your repo. An approved translation overwrites a local catalog value and says so
in the log with both values; the reviewed answer wins, and the old one survives in the append-only
hive.

No XML dependency was added. `@zintljs/compiler` has three, all installed by everybody including
people who will never enable this facet, and a parser in front of all of them for an opt-in feature is
the wrong trade. The reader handles the shape this facet writes and **says when it cannot read
something** — a segment using XLIFF inline elements is refused by name through the same report, rather
than guessed at.

Design, and the defect this found in its own first version, are in
`docs/spec/proposals/032-export-import-facets.md` §7.4.
