---
"@zintljs/compiler": minor
"zintljs": minor
---

Export strings to XLIFF, carrying what only the boundary graph knows.

```ts
import { xliffFacet } from "zintljs/facets";

zintl({ locales: ["en", "ar"], facets: ["builtins", xliffFacet({ outDir: "./l10n" })] });
```

A production build writes `l10n/<locale>.xlf`. Nothing is written while serving — an export is a
batch act, not a live sync — and your repo never gains an XML file unless you add this facet.
Catalogs stay JSON and stay the thing a human edits.

The point is not that Zintl writes XLIFF; plenty of things write XLIFF. It is what each unit carries,
all of it derived from the import graph rather than typed by anyone, so none of it can go stale the
way a hand-written context field does:

```xml
<unit id="c711797a">
  <notes>
    <note category="zintl:note">Shown after a successful payment</note>
    <note category="zintl:element">Appears as: h1</note>
    <note category="zintl:screens">Appears on: src/Checkout.tsx</note>
    <note category="zintl:placeholder">{user_firstName} is user.firstName</note>
  </notes>
  <segment state="initial">
    <source>Welcome back, {user_firstName}!</source>
    <target></target>
  </segment>
</unit>
```

Two of those no translation system can work out for itself.

**A shared string is exported once and says so.** The same words in four places produce one unit and
a note saying one translation covers all four — the difference between a safe edit and a regression,
knowable only from the import graph.

**A carry-forward arrives pre-filled and flagged.** Edit a source string and Zintl reconciles first,
then _states the answer_: the old wording, the similarity, and a warning when a whole word changed.
The TMS's own fuzzy matcher never gets a turn, which matters because two translation memories
guessing independently disagree in ways that are miserable to debug — neither side is malfunctioning.

A pending locale is exported too. It is exactly the locale a translation system is working through.

**A new `exchange` facet concern** carries this, and will carry import when that lands. The compiler
contributes material and the facet contributes serialization, the same division the bundler facets
have: nothing in core knows what XLIFF is, so a vendor facet can be written by someone who is not us.
The export runs _before_ `verifyIntegrity` rather than after, deliberately — the build most in need of
an export is the one about to fail for missing translations.

Import is not implemented. It lands with the validation gate in front of it, not behind it.

Design and what building it corrected are in `docs/spec/proposals/032-export-import-facets.md` §7.3 —
including the first shape, which grouped units by boundary, passed all thirteen tests, and put the
same string in front of a translator twice.
