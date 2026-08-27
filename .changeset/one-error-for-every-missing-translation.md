---
"@zintljs/compiler": minor
---

Report every missing translation in one build error, instead of the first one.

The rule is unchanged and stays absolute: there is no fallback to the source locale, so an
untranslated string fails the build. What was wrong was the **announcement**. `verifyIntegrity`
threw from inside a nested loop over files × boundaries × locales × keys, so the first missing key
ended the build and the other N-1 were never mentioned.

Follow what that does to someone adopting Zintl. Dev works — catalogs are written with empty values,
nothing complains. Then `vite build` fails, naming one string. They translate it, rebuild, and it
fails on the next one. A 200-string app in three locales is 600 sequential builds to discover a
failure set the compiler already held in full, on the first one. That is the first build a new user
ever runs, and it was the worst-shaped output in the whole tool.

Both failure classes are now collected and reported once:

```
[Zintl Integrity Error] 18 missing translations across 3 locales.

Every locale (ar, fr, zh) is missing the same 6 strings.
The catalogs have most likely not been filled in yet.

Zintl never falls back to "en", so these strings would render empty.
That is why this is a build error rather than a warning.

  src/main — 3 strings
    "Welcome back!"
    "Sign out"
    "You have {count} new messages"
  src/nav — 3 strings
    "Settings"
    "Profile"
    "Dashboard"

Each file needs one catalog per locale. For src/main:
  zintl/src/main.ar.json
  zintl/src/main.fr.json
  zintl/src/main.zh.json

Fix:   fill in the empty values in the catalog files above.
Defer: set `verifyIntegrity: false` to skip this check while you evaluate
       — those strings will render empty until they are translated.
```

Three decisions inside that are worth naming.

**The report has two shapes, because these are two different problems.** When every locale lacks the
same keys the catalogs simply have not been filled in, and the listing says so once — per-locale
grouping would repeat an identical block once per locale and, at ten locales, push the actionable
part off the terminal. When the sets differ, the question is _which_ locale fell behind, so the
grouping is by locale and the counts are per locale.

**An anchor targeting an unbuilt locale is reported instead of, not alongside, missing
translations.** `zintl("de")` with `de` absent from `locales` makes every downstream missing
translation a consequence rather than a finding, so that error stands alone.

**The example catalog paths are real `getCatalogPath` results, relativized to the project root** —
not a `[locale]` token substituted into `catalogFormat`. The format is user-supplied and need not
mention the locale literally, so substitution would print paths that do not exist.
