---
"@zintljs/compiler": patch
"zintljs": patch
---

Refuse a build where `assetsTarget` or `virtualAssets` configures a facet the project removed.

These options configure the **built-in** assets facet. Name your own `assetsFacet` in `facets`, or
drop the built-in with `excludeFacet`, and the options were still accepted, still type-checked, and
configured nothing — so the files they named were quietly not localized, and nothing said so.

That is now a hard error at construction, naming both signals and the way out:

```
[Zintl] `assetsTarget` configures the built-in "system-static-assets" facet,
which this project replaced with its own.

The option would have been accepted and then ignored, so the files it names
would not be localized and nothing would have said so.

Fix:    pass them to your own facet instead — assetsFacet({ targets: [...] }).
Or:     remove `assetsTarget` from the plugin options.
```

**Both spellings stay.** Two ways to say the same thing was never the harm here — `docs/stability.md`
already documented which one wins, and the semantics were not in doubt. The harm was that the runtime
did not agree with the documentation. There is also no winner available to pick: an option cannot be
forwarded into a facet you constructed yourself, so honouring both was never on the table, and the
only thing left to get right was saying so.

An error rather than a warning because the consequence is wrong output rather than a surprising
configuration — assets shipping in one language — and a line in a build log is a poor defence against
that.

`virtualAssets` counts only when `true`. It is resolved against a default before facets are assembled,
so `false` cannot be told apart from unset, and `false` is the facet's own default anyway — treating
it as a signal would refuse builds that are entirely correct. Settles proposal 034 §8.
