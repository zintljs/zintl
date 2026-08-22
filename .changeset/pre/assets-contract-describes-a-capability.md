---
"@zintljs/testing": minor
---

Made the localized-assets contract describe a capability rather than one project, so more than one app can claim `assets`.

The contract imported its expected strings from the `assets-basic` fixture and asserted them against `adapter.headingSelector`. That made it a test of one app wearing a capability's name: any second project claiming `assets` would have been asserted against the first project's text, in whichever element happened to be its heading. It survived only because it had exactly one claimant, for which "the heading" and "the localized asset" were the same element by coincidence.

The selector and the per-locale expected text now come from a new `AssetsAdapter`, alongside a `navigateLocale` that loads the app cold in a given locale — a fresh navigation rather than a runtime switch, because this contract is about the build substituting the right asset for the active boundary, not about switching afterwards. `assetSelector` is deliberately separate from `headingSelector`: in the normal case they are different elements, which is what the old shape could not express.

`rsbuild-spa` now claims `assets` and `boundary-graph`. The first is the one that matters — the defect where Rspack typed Zintl's generated JavaScript by its `.txt` extension and base64-encoded it into a `data:` URI had a green build and green contracts, and was caught only by reading a snapshot. It is now asserted in a real browser against rendered Arabic text.
