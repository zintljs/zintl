---
"@zintljs/compiler": minor
"zintljs": minor
---

Localized assets are authored, not derived — and an unfilled one now fails your build.

**This is a breaking change, and the first build after upgrading is where you will meet it.** A
project can have had targeted assets for months without ever filling a variant, because nothing has
ever said so.

Zintl used to treat a localized file as something it _made_ from the source: parse the frontmatter,
merge it, score how much the body had drifted, back the result up, and warn you to re-translate. When
it had nothing to write, it wrote the source's bytes. That last step is the defect. A byte-identical
artifact is a fallback to the source locale, and nothing anywhere could tell an untouched one from a
finished one — so a German page shipped English text and the build said nothing.

The assumption underneath it does not survive contact with what people actually localize. A German
legal PDF is not derived from the English one. A photograph of the Tokyo storefront is not derived
from the Paris one. A dubbed audio track, a right-to-left poster, a table of branch addresses — none
of these are transformations of a source. **Localization is not translation.**

**What happens now.** Targeting a file declares that a slot exists. Each targeted asset gets an
_empty_ artifact per locale, and a person fills it:

```
zintl/src/legal/terms.de.pdf     0 bytes
zintl/src/media/hero.de.webp     0 bytes
```

Empty rather than a copy, because a zero-byte file cannot be mistaken for finished work — and it
tells you the exact path to produce, which is the one thing the compiler is in a position to know.
An unfilled artifact then joins the integrity report under the same `verifyIntegrity` option, with
the same meaning: `translation === ""` and `size === 0` are one rule in two representations.

```
[Zintl Integrity Error] 3 unfilled localized assets across 2 locales.

  de — 2 empty
    zintl/src/legal/terms.de.pdf
    zintl/src/media/hero.de.webp

Fix:   fill the files above.
Or:    stop targeting the asset, if it is the same in every locale.
```

The second remedy matters as much as the first. An asset identical in every locale is one you never
target, so removing it from `assetsTarget` is a correct and complete answer rather than a workaround.

**No file type is special any more, so none needs naming.** `AssetMergeStrategy` is gone, including
its function form — a hook taking the source bytes and returning the localized ones is content
crossing a boundary that should not have one. `AssetTargetConfig.strategy` goes with it, leaving
`targetPattern` and `outputPattern`: which files are targeted, and where their artifacts go. The
extension table that used to infer a strategy is not made configurable, as an earlier design
proposed; it is deleted, because there is nothing left for it to decide.

`similarityThreshold` is gone from the assets facet too. The plugin's option of the same name is
untouched — it governs string reconciliation, which still compares things. Assets never are.

**How an artifact reaches the browser is decided by your import**, which is the bundler's own
convention rather than a rule Zintl invented:

```ts
import text from "./about.txt?raw"; // the contents, inlined into the catalog
import url from "./hero.webp"; // the URL of this locale's artifact
```

That second line works for the first time. Binary assets were excluded from catalogs and resolved by
nothing, so a targeted `.pdf` was copied to disk and never read by anything; now the bundler emits
and hashes the per-locale artifact and the URL becomes the catalog value, so chunking, hydration,
runtime locale switching and hot updates all work on a video without knowing it is one.

**A source edit no longer touches your artifacts, or warns about them.** Whether the German version
has fallen behind the English is a real question, and not one a compiler that can only see that bytes
differ can answer; warning on every source edit trains you to ignore the warning. Moving or renaming
a source _does_ carry its artifacts with it — identity is content-based here as everywhere else, and
restructuring a directory must not orphan a PDF somebody commissioned.

**Also fixed, all of them the same bug wearing different clothes:** four more paths fell back to the
source locale when an artifact was missing — during resolution, during load, and in generated runtime
code as a literal `|| sourceContent`. An unfilled artifact now serves empty and, in development, says
so once in the terminal naming the file to fill.

`virtualAssets` keeps its name and narrows its meaning: artifacts are always written, because an
author needs a file to fill, so it now chooses the delivery route and nothing else.

Finally, the plugin's load path used to test for `.md` and `.txt` by hand while its resolve path
asked the facet — so a configured `.rst` target was recognised when its import resolved and then
unknown when the module loaded. It asks the facet in both places now, and `ContentFacet` can declare
the extensions it claims, which makes two content facets fighting over one file an error at
construction rather than a silent race.
