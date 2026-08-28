---
"zintljs": minor
"@zintljs/compiler": minor
---

Add `pendingLocales` — a locale you are standing up, maintained on disk and shipped nowhere.

Adding `de` to `locales` on the day you start translating it fails every build for the month it takes,
because German is 0% done. The available workaround was `verifyIntegrity: false`, which takes the gate
off `ar` and `fr` too — the locales that are already live, with real users. That is a per-project
switch answering a per-locale question.

```ts
zintl({
  locales: ["en", "ar", "fr"],
  pendingLocales: ["de"],
});
```

A pending locale is extracted, given catalog files, reconciled as the source changes, and counted in
the status line as `de 3/47 (pending)`. It is exempt from `verifyIntegrity`, emits no catalog chunk,
and is absent from the runtime locale list. **The no-fallback rule is untouched**: nothing renders
blank, because nothing renders in German at all until you move the string into `locales`. That move
is the whole of promotion, and the build gates it from that moment.

`zintl("de")` on a pending locale is still a build error, but a different one from `zintl("zz")`. The
report separates them and gives opposite advice, because telling the first author to "add the locale
to `locales`" is telling them to ship German blank.

**`locales` answered two questions and now answers one.** It meant both _which locales do we maintain
catalogs for_ and _which locales do we ship_; those were the same list only because nothing had needed
them apart. `locales` keeps the shipping meaning and a new `maintainedLocales` carries the other, so
every read site left unconverted stays ship-correct — a missed site can only fail to maintain a
pending locale, never ship an untranslated one. With `pendingLocales` unset the two are the same
array, so nothing that does not use this feature can be affected. Facets see both on `CompilerContext`;
`locales` remains the safe default for a facet that does not care.

The sharp edge is pruning, and it is worth naming because it is the one place a mistake destroys work
rather than producing it. `pruneOrphanedBoundaries` deletes every file under `outputDir` it does not
recognize; handed the shipped list, a pending locale's half-finished catalog is an orphan by
construction and a production build removes a month of translation. Same for `getActiveOutputPaths` in
the assets preset, where the file at risk is a translator's authored artifact. Both read the
maintained list, and both have a test that was confirmed to fail without it.

The per-locale status line no longer counts a pending gap toward the number that predicts a build
failure — a build with a 0%-translated pending locale passes, so warning about it would be false:

```
Translations ar 47/47 · de 3/47 (pending) — shipped locales complete; de is not shipped yet
```

Design, the framing this feature does _not_ solve, and what building it changed about that design are
in `docs/spec/proposals/031-pending-locales.md`.
