# @zintl/compiler

## 0.1.0-alpha.20

### Patch Changes

- 92ad9fe: Read the locale from below the base path, not from the top of the URL.

  `syncLocale` took the locale from the first segment of `location.pathname`, and the HTML bootstrap
  did the same. For an app served from a domain root that is correct. For one served under a base
  path it reads the base:

  ```
  /zintl/ar/guide/what-is-zintl
   ^^^^^ ← "the locale"
  ```

  `zintl` names no locale, so the lookup fell through to `<html lang>` and to storage, and a site
  deployed under a sub-path served every reader its **source language** no matter which URL they
  opened. Silently — the page rendered, in the wrong language, with the right one in the address bar.

  This is not an unusual deployment. GitHub Pages project sites, anything behind a path-prefixed
  reverse proxy, and any app mounted under a sub-path all hit it, and path-based locale routing is the
  shape the client facet was built for.

  The base now reaches the runtime as `__ZINTL_BASE__`, folded to a literal by `getRuntimeCode` the
  same way `__ZINTL_RTL_LOCALES__` is, and to the HTML projection as an argument to `transformHtml`.
  Both strip it before looking for a locale. It comes from the resolved config — the same
  `ctx.publicBase` the preload URLs already use — so nothing new has to be configured.

  `"/"` is the default at every level, so an app at a domain root is unaffected: across the suite this
  changes two generated lines and no behaviour, and every project still resolves its locale exactly as
  before.

  Found by deploying the documentation site to `zintljs.github.io/zintl/`, where every page rendered
  in English.

- 375e226: Read the whole of a Vue component past a nested `<template>`.

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

- 2937c0c: Give a lazily-routed page's own components their catalogs.

  Two different walks answer "what does this chunk reach dynamically", and they disagreed.
  `computeTranslationChunks` records the full set on the chunk; the set the catalog collection actually
  used came from `getReachableHandshake`, which stops earlier. For a lazy route made of components the
  page arrived and the components it renders did not — so a sidebar and a table of contents behind a
  lazy route had catalogs on disk, a green `verifyIntegrity`, and empty text in every locale but the
  source.

  The collection now takes the union of the two rather than only the caller's set. Neither is a
  superset of the other — the caller's is computed from an anchor and can name boundaries the chunk
  walk does not — so dropping either would trade this defect for its mirror image.

  Found by the documentation site, whose docs shell is exactly that shape: one lazy route rendering a
  sidebar, a table of contents and a pager.

- a496952: Make the locale preload hint point at the catalog it means to warm.

  The HTML projection writes a `modulepreload` per locale so the catalog is in
  cache by the time the store asks for it. It had two faults, and between them the
  hint never once did its job on a route below the root.

  **The URL was relative.** The base was read from `viteCtx.server.config.base`, and `server` exists
  only in dev — so a production build fell back to `""` and emitted a bare `assets/entry_….js`.
  Assigned to `link.href` that resolves against the _document_, so `/guide/page` asked for
  `/guide/assets/entry_….js`: a 404 on every deep-route load, and a preload that warmed nothing.
  Quietly, because the real import is written `./entry_….js` from inside a module and resolves
  correctly — the page worked, and only the network panel showed otherwise.

  On a host with the SPA fallback a single-page app needs, it is worse than a 404: the request returns
  `index.html` with a 200 and the preload fails on its content type instead.

  The base now comes from `configResolved`, where it exists in both modes. **Every project's preloads
  were relative** — this shows up as an absolute path in twenty contract snapshots.

  **And it preloaded the wrong locale.** The bootstrap chose from `localStorage` alone, so arriving at
  `/es/guide` with `ar` left in storage applied Arabic `lang`, `dir` and `<title>` to a Spanish
  document and fetched the Arabic catalog. It now reads the first path segment first and falls back to
  storage, which is the precedence `syncLocale` already uses. A path whose first segment names no
  locale falls through exactly as before, so apps that keep the locale in `?lang=` are unaffected.

  Guarded by two tests whose fixture has **no `server`**, which is what a build looks like. The test
  that covered this path supplied one, and that is why the relative URL survived being tested.

- 4d7ae52: Stop a Vue entry re-mounting itself into a blank page.

  The Vue runtime facet left `entryReexecutionSafe` at its permissive default, on the stated reasoning
  that "Vue's mount is replayable where React's `createRoot` and Svelte's `mount` are not". It is not.
  The difference from React is only in how loudly it fails.

  `createApp(App).mount("#app")` builds a **new application instance** every time it runs. On a
  container that already has one, Vue's DOM mount clears `innerHTML` and renders the new app into it,
  and never unmounts the old one — whose reactive effects are still scheduled and still hold
  references to the nodes just removed. React throws on a container it already owns; Vue warns, wipes
  the page, and then dies in the first effect reaching for a `nextSibling` that is no longer there.

  Measured on a Vue documentation site: editing a localized `.md` artifact invalidates each boundary's
  source module — an asset edit is deliberately not treated as a hot catalog edit, because a URL asset
  bakes its resolved URL into the source — so the entry re-ran, mounted a second app, and the page
  went empty until a manual reload. Reproduced on an unmodified checkout before anything was changed.

  With the flag declared, such an entry accepts and immediately invalidates, and the update bubbles to
  a reload: the edit is shown rather than swallowed. That cost is exactly what the flag exists to
  trade for, and it is the trade React, Svelte, Lit and Solid already make.

  Preact keeps `true` and is right to — its `render(vnode, container)` diffs into the same container
  rather than constructing a second root. The flag is about that distinction.

  No behaviour changed for any non-Vue project. Across the suite this moves two dev-transform
  snapshots and the `entryReexecutionSafe` line of sixteen facet compositions; every HMR contract
  passes unchanged.

- 5ddac1a: Fix strings reached through an exported function never arriving in any catalog chunk.

  A module whose strings live in one function and whose entry point imports another — the shape every
  data module takes — shipped empty:

  ```ts
  function nav() {
    return { sections: [{ title: "Guide" }] }; // sinks land on `src/nav:nav`
  }
  export function getSections() {
    return nav().sections; // the boundary an importer resolves to
  }
  ```

  The catalog was written to disk and filled, `verifyIntegrity` passed because the file was complete,
  and the titles rendered pseudo-localized in dev and **empty in production**. A missing translation
  is supposed to fail your build; this one passed it.

  `GraphManager` drops a boundary that has no strings of its own, no anchor, and no dependencies,
  keeping only those that can serve as pass-throughs to content further down. The dependency test asked
  the **file's** imports — and `src/nav` imports nothing, so `src/nav:getSections` was deleted as a
  leaf. It was not a leaf: `internalDependencies` already recorded `getSections → nav`, the very edge
  that reaches the fourteen strings. Every walk over the boundary graph then hit a dependency with no
  node behind it and stopped there.

  The guard now counts internal edges as dependencies, which is the case the rule already meant to
  keep — it was simply asking the file instead of the boundary.

  Surgical reachability is untouched: an export still reaches only what it calls, and a module-level
  string nothing reads is still left out of the entry catalog. In the suite this adds one intermediate
  node to `vanilla-ssr`'s graph and gives it an owner; no chunk lost a boundary.

- Updated dependencies [40b2a56]
- Updated dependencies [d3d3112]
- Updated dependencies [2d21d06]
  - @zintljs/extractor@0.1.0-alpha.20

## 0.1.0-alpha.19

### Minor Changes

- a49ea5f: Add `pendingLocales` — a locale you are standing up, maintained on disk and shipped nowhere.

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

- f3549fa: Report per-locale translation completeness on every dev flush.

  `ar 44/47 · fr 12/47`, printed when it changes and only when it changes.

  The gate already tells you, in full, and refuses the build. That is correct and it is also _late_:
  the first a team hears of a missing translation should not be CI going red on a Friday afternoon.
  Between "nobody has mentioned this" and "the release is blocked" there was nothing.

  Two decisions worth stating, because both could reasonably have gone the other way.

  **Counted against the hive, not by re-reading catalogs.** The hive is what `verifyIntegrity` already
  accepts — a key it can satisfy is a key that passes the gate — so the number cannot disagree with
  whether the build will succeed. A status that read "complete" while the build failed would be worse
  than no status. It is also pure in-memory set arithmetic, where re-reading every catalog for every
  locale on every dev flush would not be.

  **Serving only.** A build either passes at 100% or fails with the list, so a build-time summary could
  only ever say "everything is translated". Dev is where the number is both true and interesting.

  **Incomplete logs at `warn`, complete at `info`** — severity tracking consequence rather than tone.
  An incomplete locale is not a status update, it is a build that is going to fail. At `info` it would
  be the first line to vanish for anyone running `logLevel: "warn"`, a common choice in CI, who would
  keep every line they did not care about and lose the one that predicts the failure. The warning says
  what it will cost, because that is the justification for the level.

  An empty string counts as untranslated, matching the gate. The source locale is left out entirely —
  never written to disk, translated by definition, and a permanent `0/N` would mean nothing.

  `getTranslationStatus()` is public, so a facet or a host integration can ask for the same counts
  without going through the log.

  **Debounced, and that is a measurement rather than a preference.** Computed inline on the flush,
  counting every manifest key against every locale pushed `Colony HMR Latency (Manager Sync)` from
  inside its budget to 3.2x calibration against a 1.6x budget — cheap in isolation, not cheap on the
  HMR hot path. `vpr bench` caught it; re-running the benchmark with the call removed confirmed the
  cause was the call and not the machine. Nothing needs this number synchronously, so it waits for the
  edits to stop, which also means one line per burst instead of one per keystroke.

  Pending locales — the case where this number would have content at build time as well — are designed
  and deliberately deferred past the first beta. See
  [proposal 031](/docs/spec/proposals/031-pending-locales.md), which also records why they are _not_ an
  answer to a red build on a Friday, and what is: an explicit, temporary `verifyIntegrity: false`, now
  documented in `docs/configuration.md`.

- d577ad0: Show untranslated strings as `⟦Ẇéļçöṁé ƀàçķ!⟧` while serving, instead of blanking the page.

  Catalogs start empty. `verifyIntegrity` is off while serving by design, and a missing key resolves
  to `""`. So the first thing a new project did, on the very first locale switch, was **empty itself**
  — every string gone, no error, no warning on the page, nothing in the terminal. The dev server is
  where someone decides whether to keep this package, and what it showed them was a blank app.

  The build error was fixed in the same release. This is the other half, and the worse half: a build
  failure at least says something.

  `pseudoLocalize` (default `true`) renders a miss as visibly-untranslated text:

  ```
  ⟦Ýöü ĥàṽé 3 ñéẁ ṁéššàĝéš⟧
  ```

  **This is not a fallback to the source locale.** That rule is not bending, and the design is what
  keeps it from bending:

  - The text is unmistakable. Nobody reads `⟦Ẇéļçöṁé⟧` as a translation, nobody ships it, and nobody
    builds the habit of a dev app that looks finished. A placeholder that could pass for a translation
    would be a source fallback wearing a costume.
  - It cannot reach production. The branch sits inside `__ZINTL_DEV__`, and `getRuntimeCode` folds
    `__ZINTL_PSEUDO__` to a literal `false` for every build — so the guard, the branch and
    `pseudoLocalize` itself are all eliminable, and the rule that nothing ships unused holds.
  - The build still fails. `verifyIntegrity` is unchanged and refuses the same set of strings.

  Two details that decide whether this is useful or merely visible.

  **Placeholders and markup are preserved.** `{count}` is read back by `interpolate`, `<t0>` by the
  tag restoration after it; accenting either would turn a visible placeholder into a broken one. The
  transform splits on both and leaves them alone.

  **The pseudo string falls through rather than returning early**, so it goes through interpolation and
  tag restoration like any real message. `{count}` shows the real count and markup renders as markup —
  the layout stays honest and only the words announce themselves. Returning early would have produced
  a page full of literal `{count}` and `<t0/>`, which tests nothing about your layout.

  Four unit tests asserted the old empty string on the miss path and now assert the marked one. A fifth
  that looked similar was left alone on purpose: a catalog entry present but non-string still returns
  `""`, because that is a different branch and a different bug.

  **The build-output snapshots earned their keep here.** The obvious way to write the miss path — assign
  in the dev block, re-test `message` after it — folds to a redundant `if (message === void 0)` nested
  inside its own `if (message === void 0)`, in every shipped bundle. The dev branch disappears; the
  extra test does not. It is invisible in the source and obvious in the snapshot diff, which is exactly
  what those snapshots are for. The `else return` shape now carries a comment saying so, because the
  natural way to write it is the wrong way.

  One asymmetry worth knowing, measured rather than assumed. With minification off — which is how the
  contract harness builds, so the snapshots stay readable — Rollup drops the now-unreferenced
  `pseudoLocalize` and its two tables, and **Rspack does not**: it defers unused top-level bindings to
  the minifier. Every real production build minifies, and `examples/*/dist` is clean of all four
  symbols on both hosts, so nothing reaches a user either way. But the Rsbuild snapshots do show them,
  and that is a tree-shaking gap rather than a leak. Closing it properly means giving the helper its
  own runtime module and serving an empty one when not in dev, the way `store-client` and
  `store-server` are already composed — deliberately not done here, for a dev-only affordance.

- 25917f5: Localized assets are authored, not derived — and an unfilled one now fails your build.

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

- f054592: Take translations back from XLIFF, and refuse the ones that would render wrong.

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

- 9819267: Export strings to XLIFF, carrying what only the boundary graph knows.

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

- 5df1221: Report every missing translation in one build error, instead of the first one.

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

- d1f0cd9: Stop extracting `el.title`, `el.value` and friends by default.

  `dom:prop:` targets match a property **name** and learn nothing about the receiver. There is no type
  information on an oxc parse and dataflow tracing was removed deliberately (backlog 005), so nothing
  ever checked that the thing being assigned to was a DOM node:

  ```ts
  featureFlag.value = "NON_DOM_value"; // extracted
  telemetry.title = "NON_DOM_title"; // extracted
  sqlBuilder.innerHTML = "NON_DOM_innerHTML"; // extracted
  ```

  Extraction rewrites the value, so an extracted analytics constant comes back **translated at runtime**
  — and, because there is no fallback, also fails the build until somebody translates an event name.

  A default sink target must never catch text that is not user-facing. These did.

  **Kept:** `innerHTML`, `textContent`, `innerText`. **Dropped:** `alt`, `placeholder`, `aria-label`,
  `aria-description`, `value`.

  `title` was dropped, had to come back, and then stopped needing an exception. `document.title` is the
  browser tab — as user-facing as text gets — so removing it stopped real page titles being extracted.
  It differs from its neighbours in one way that matters: its receiver is the `document` global, a
  literal identifier in the source, which is structural evidence rather than a guess about a noun.

  So the `dom:` family is now receiver-qualified, the way `jsx:<element>:<attribute>` always was:

  ```
  dom:prop:innerHTML     any receiver          (the original spelling, unchanged)
  dom:*:innerHTML        any receiver          (alias, matching jsx's convention)
  dom:document:title     document.title only   (new)
  ```

  ```js
  document.title = "REAL_PAGE_TITLE"; // extracted
  telemetry.title = "NOT_UI_title"; // not
  ```

  The receiver must be a plain identifier — `window.document.title` does not match, deliberately, since
  following member chains re-admits the guessing this removes. The receiver check runs only when the
  any-receiver set misses, so the common path is untouched.

  Only `vanillaFacet` declared the English words; `svelte` and `vue` already declared just `innerHTML`
  and `textContent`. The rule was being followed everywhere except the one facet that applies to every
  project.

  **A note on how this was measured, because the first measurement was insufficient.** A static audit of
  all 30 examples reported 0 affected and 0 strings lost — true of the sources as committed, and blind
  to the fact that contract fixtures _synthesize_ source at test time. Eight of them insert
  `document.title = "Extra anchor added"`, which is what gives a new anchor's boundary content, and
  without it `[HMR Growth]` fails deterministically: 10/10 runs with the change, 0/10 at baseline,
  measured in one batch with `scripts/flake.js`. An audit of static sources cannot see strings a test
  writes.

  Dropped from the defaults, not from the DSL — `vanillaFacet({ targets: [...] })` takes them back, and
  then the false positives belong to whoever asked for them. There is a test for the opt-in path as well
  as the removal.

  `obj:field:*` has the same defect and is **not** touched here: two examples depend on it, and it needs
  somewhere to go first. See [proposal 033](../docs/spec/proposals/033-structural-defaults-and-declared-targets.md),
  which measures that too and sequences the replacement — declared `obj:<name>:<field>` targets, a
  `@zintl-target` directive, and `tag:` for self-built HTML.

  The descriptor forms are now documented for users as well, in `docs/configuration.md` — "What counts
  as a translatable string" and "Changing what is extracted". The DSL had never been documented at all,
  which made the defaults something you could only discover by being surprised by them.

  **Extraction targets are now validated.** An unrecognised descriptor was silently ignored — no target,
  no hint, no message — so a typo (`dom:prop:titel`) and a form that does not exist (`obj:ui:title`)
  both resolved to silence, and a user who asked for an extraction got none with nothing to read. That
  is the same silent under-extraction that makes a missing sink invisible, arriving through a config
  file, where it is worse: the intent was stated.

  Every form now either matches or is refused at construction, with the valid forms listed in the error:

  ```
  [Zintl] Invalid extraction target: "obj:ui:title" — unrecognised form.

  Valid forms:
    jsx:<element>:<attribute>   e.g. jsx:*:alt, jsx:html:dir
    html:attr:<attribute>       e.g. html:attr:placeholder
    dom:<receiver>:<property>   e.g. dom:*:innerHTML, dom:document:title
    …
  ```

  Unknown prefixes, wrong arity (`jsx:alt`), empty segments (`tag:`) and paths where a single name is
  expected (`html:attr:a:b`) are all refused. `dom:attr:` is refused explicitly as never-implemented
  rather than left accepted-and-inert — it was in the descriptor union and the DSL docblock, registered
  a fast-path hint, joined no target set, and matched nothing. A test had recorded that no-op as a
  feature; it now asserts the refusal instead.

  A falsy entry is still skipped rather than refused: a hole in a list is not a stated intent.

- 300c310: Remove `obj:field:*` from the default extraction targets.

  A default sink target must never catch text that is not user-facing. `obj:field:label` matched a field
  name on **any object literal anywhere**, knowing nothing about the object:

  ```js
  // what you wrote
  export const analytics = { label: "signup_button_click" };

  // what shipped
  export const analytics = { label: _t("signup_button_click", …) };
  ```

  Extraction rewrites the value, so in Arabic that event name came back in Arabic. And with no fallback
  to the source locale, it also failed the build until somebody translated it. No curation of the field
  list fixes that, because the name is the entire signal.

  The capability did not go anywhere — it now says _which_ object it means:

  ```ts
  const ui = { home: { title: "Welcome" } }; // obj:ui:title
  defineConfig({ title: "My site" }); //        call:defineConfig:title

  // @zintl-target
  export default { title: "…" }; //             no name to point at
  ```

  **`tag:html` is a new vanilla default**, and it is the answer for an app that builds its own HTML — the
  common vanilla and SSR shape whose only working answer used to be _name the field `text`_. A tag cannot
  fire by accident: the author has to write `` html`…` `` around the string. Lit already declared it.

  **Next.js metadata is targeted rather than suppressed-and-bypassed.** `metadata` and `generateMetadata`
  used to be suppressed with `bypassIf: "hasAnchor"`, so extraction depended on putting a `zintl()` call
  inside the function. That happened to work for `generateMetadata`, and left the far more common static
  `export const metadata = { … }` unreachable — no anchor, no strings, no message. `title` and
  `description` are now named precisely, which also keeps `icons` and the Open Graph URLs out.

  ### Migrating

  **Almost certainly nothing.** Measured across all 30 examples after the removal: every one extracts the
  same strings as before. The two that depended on `obj:field:*` were migrated first, and their actual
  strings — not just counts — were compared.

  **Vue's Options API is the exception, and the only one.** Strings in a `data()` return are ordinary
  object fields:

  ```vue
  <script>
  export default {
    data() {
      return { field: { label: "Save changes" } };
    },
  };
  </script>
  ```

  `obj:<binding>:<field>` cannot reach that either: `data` is a property of the default-exported object,
  not a declaration, so there is no binding to name. Mark it instead:

  ```diff
     data() {
  +    // @zintl-target
       return { field: { label: "Save changes" } };
     },
  ```

  If you were relying on object-field extraction elsewhere, `obj:*:label` restores the old behaviour
  exactly — and now says out loud what it does.

  **One cosmetic consequence of adopting `tag:html`.** A tagged template is markup the formatter can
  see, so oxfmt will format the HTML inside it — `examples/vanilla-ssr` came back with its SVG and list
  markup re-wrapped across lines. Extraction is unaffected (the same 15 strings, verified by content
  rather than count), but it will show up in your diff the first time you migrate a template, and it is
  better to expect it than to wonder.

  See [proposal 033](../docs/spec/proposals/033-structural-defaults-and-declared-targets.md), §8.1 for the
  measurement and §8.2 for the Vue case.

- 0177060: Derive everything the graph knows about a string, for whoever has to translate it.

  A catalog is `{ "Open": "" }`. Next to the code that is exactly right — the source text is the key
  and the call site is a click away. Handed to a translator with no repo and no screen it is close to
  worthless: they cannot tell whether _Open_ is a verb or an adjective. Every TMS answers this with a
  hand-written context field that goes stale the day after somebody types it.

  `ZintlCompiler.getMessageContext(boundaryId, key)` answers it from the boundary graph instead, which
  means it cannot go stale:

  - **Which screens the string reaches** — the entry points that actually depend on this boundary.
  - **What else an edit would change** — every other boundary carrying the same words. Translators are
    never told this, and it is the difference between a safe edit and a regression.
  - **What produced each placeholder** — `{input}` alone is unanswerable; `user.firstName` is not.
  - **Where it sits** — `alt`, `button`, `h1` — plus the `@zintl-note`, the tag map, and whether it is
    part of a larger stitched sentence.

  None of this is new machinery; it is a read off graphs the compiler already keeps. The derivation
  lives in `packages/compiler/src/message-context.ts` as a pure module over explicit inputs, in the same
  shape as `reconcile.ts`, so the structurally interesting cases are testable without constructing a
  compiler at all.

  **An `<h1>` and a `<p>` are no longer the same thing.** They were: every HTML text node reached the
  compiler as one sink type, so "this is an `aria-label`, not an `h1`" was true for JSX and false for
  every MPA and every vanilla app. `stitchHTML` now tracks the open block elements and reports the
  enclosing one on a new `context` field — never on `sinkType`, which is how the pipeline splices a
  call back into the document and is compared for equality in three places. Human-facing context and
  replacement mechanics are two questions, and they were sharing one string.

  The element is metadata and never a key, which is what makes this safe: `generateMessageId` ignores
  the context it is passed, so an `<h1>` and a `<p>` holding the same words remain one translatable
  unit with two recorded contexts. No message identity moves, no catalog changes, and the 383-test
  contract suite produced no snapshot diff.

  **Fixes a rendering bug found on the way.** A template literal inside JSX — as a child or in an
  attribute — lost its interpolations entirely:

  ```js
  <h1>{`Welcome back, ${user.firstName}!`}</h1>;

  _t("Welcome back, {user_firstName}!", { _mgr, _bId }); // before
  _t("Welcome back, {user_firstName}!", { user_firstName: user.firstName }, { _mgr, _bId }); // after
  ```

  No params object, so the value never reached the page: the built page rendered `Welcome back,
undefined!`.

  The cause was three copies of one derivation. `${user.firstName}` becomes `{user_firstName}` in the
  extracted text, and three places decided that independently — the template branch that names the
  placeholder, the DOM-sink path that pairs a name back to its expression, and the JSX path that did the
  same. Two agreed; the JSX copy handled only bare identifiers, so a member expression was `var0` there
  and `user_firstName` everywhere else. Bindings are matched to placeholders **by name**, which is why
  it was silent: a mismatched name produces no binding rather than a wrong one. There is one copy now.

  Nothing caught it because no project in the manifest used a template literal inside JSX —
  `vanilla-ssr` uses one on a DOM assignment, the route that already worked, and every JSX project
  writes plain JSX children. Two well-covered halves of one feature and nothing across the join.

  That is closed too: a unit test asserting the emitted call rather than the manifest, and a
  `jsx-template` contract fixture that renders the shape in a real browser. Both were confirmed to fail
  with the fix reverted, which is what makes them guards rather than descriptions.

  Design, the seam this serves, and both decisions it rests on are in
  `docs/spec/proposals/032-export-import-facets.md` — including §8.2, now settled: only an `approved`
  translation is imported, because a gate is worth having only while it means exactly one thing.

### Patch Changes

- 3247708: Make a plainly imported localized asset follow the active locale, instead of only the build.

  Targeting an asset says its content varies by language. For an asset imported with `?raw` that has
  always held. For one imported plainly — a `.webp`, a `.pdf`, a video, anything you want the _URL_ of
  — it held in a production build and nowhere else. Every dev server, and every app that switches
  language at runtime, served the source file in all locales.

  The cause is that a plain import is a **static binding**: it resolves once, to one file, and nothing
  re-reads it when the locale changes. So reference delivery followed the locale exactly where module
  _identity_ did — a multiplexed build, where resolution rewrites each import per locale — and the
  per-locale URLs sitting in the catalog were never read by anything.

  An import of a targeted asset now resolves to a module that reads the active locale on every access,
  which is what the `?raw` side has always done. The two delivery modes are the same shape and differ
  only in what the catalog holds: the artifact's text for one, the bundler's URL for the other. The
  bundler still emits and hashes each locale's file exactly as it would any asset — there is no new
  emission path and no host-specific code.

  The source locale is answered by a direct import rather than through the catalog, because its artifact
  _is_ the source file: nothing to look up, and under ghost mode no catalog on disk to look it up in.

  **`ContentFacet` gained `deliversUrl`,** which is the question this needed and `match` could not
  answer. Ownership says whose file something is; it is not a licence to intercept an import of it. The
  first attempt gated on ownership, claimed every `.html` — owned by the HTML projection facet, which
  delivers nothing to an importer — and fed the page template to the JavaScript parser. A facet that
  answers imports with a per-locale URL now says so.

  Two smaller things came with it. Generated modules for this path get their own virtual id rather than
  borrowing the asset's, for the reason ledger L-009 documents and one more: unplugin materialises a
  virtual module as a real file elsewhere on disk, where a bare `virtual:zintl/runtime/internal` no
  longer resolves. And the imports the catalog uses to reach each artifact carry `?zintl-url`, which the
  plugin declines — without it the generated module imports itself.

  Found by a contract that was written red and left `pending` for a release, asserting the behaviour
  this change delivers.

- e4bb3e0: Honour a configured `assetsTarget` everywhere, not only where the default one happened to be looked for.

  `assetsTarget` has been configurable for some time, and three places never asked what it said. Each
  tested `.md` and `.txt` by hand — which is not a fact about assets, but the _default_ value of the
  option — so a project targeting anything else got a different feature from the one it configured.

  **A boundary carrying only a non-default asset generated no manager at all.** The pipeline decided
  whether a boundary had any translations worth loading by scanning its dependencies for `.md` or
  `.txt`. Target `.rst`, and the answer was no: no manager was emitted, no catalog was ever requested,
  and the page rendered a pseudo-localized key. The only clue was `no manager provided` in the console,
  four layers from the cause. This is the one with user-visible consequences, and it was invisible to
  every test because every asset in the repository was a `.txt`.

  **Editing a non-default artifact did nothing.** The hot-update classifier recognised sources by
  extension, catalogs by `.json`, and assets by the same two-item list. An edit to `about.ar.rst` was
  classified as no kind of change at all, so no update ran and the browser kept the previous text until
  a reload.

  **Orphaned artifacts of non-default targets were never reclaimed.** The scan that removes files under
  `outputDir` whose source is gone matched `.json`, `.md` and `.txt`. Anything else outlived its source
  indefinitely, unreferenced and unexplained.

  All three now ask the facet layer, which is the thing that actually knows. `ContentFacet` gained
  `extensions` in the previous release for exactly this reason and the compiler gained `ownsContent`;
  these are the callers that should have been using them. The pipeline is handed the predicate with its
  context already bound, so a hot traversal pays for one closure rather than a context per dependency
  edge.

  **Found by a fixture, not by reading.** `assets-authored` localizes a `.rst` and a `.png` — neither
  in the default targets — and the first thing it did was fail. Proposal 034 §1.1 counted six sites
  that re-derived behaviour from a file extension and called the option "honoured on one path out of
  six"; it had been looking only at the assets preset and the plugin's resolve hooks. Three more were
  in the pipeline, the HMR classifier and the catalog pruner.

- 8f2853d: Refuse a build where a localized artifact and a translation catalog want the same file.

  Both are named `<outputDir>/<path>.<locale>.<ext>`, so targeting `.json` — the extension catalogs
  themselves use — can put an artifact exactly where a boundary's catalog goes. `assetsTarget:
["json"]` with an asset at `src/data.json` and a boundary in `src/data.ts` sends both to
  `zintl/src/data.ar.json`, and this succeeded:

  ```
  zintl/src/data.ar.json   ← the catalog. Written second; the artifact is gone.
  ```

  Which is the worst of the available outcomes, because it looks like success. The artifact _becomes_ a
  catalog, so `verifyIntegrity` finds a non-empty file and passes, and the asset ships in the source
  language with nothing said — a source-locale fallback nothing downstream can detect, which is the one
  thing this project's first rule forbids.

  It is now a hard error naming the file, the facet that claimed it, the boundary whose catalog it is,
  and the way out:

  ```
  [Zintl] A localized artifact lands on a path Zintl already writes a catalog to.

    zintl/src/data.ar.json
      claimed by "system-static-assets", and by the catalog for "src/data"

  Fix:    give the artifacts their own location, away from the catalogs —
          assetsTarget: [{ targetPattern: "**/*.json",
                           outputPattern: "assets/[locale]/[dir]/[name].[ext]" }]
  Or:     stop targeting this extension, or rename the source file.
  ```

  **Paths are what is refused, not extensions.** `assetsTarget: ["json"]` is safe in a project whose
  catalogs live in one multilingual file and unsafe in the default one, so an extension check would be
  both too strict and too loose. The guard indexes every path the boundary graph will write a catalog
  or schema to and refuses only on an actual overlap.

  It runs in `runFlush` rather than in the pruning scan, which had both sets in hand: pruning is gated
  on the `prune` option and short-circuits in dev, and a correctness guard an unrelated option can
  switch off is not a guard. The scan also could not have found this — it _unions_ catalog paths with
  content-facet outputs, and a union cannot show an intersection: two subsystems writing one file
  looked exactly like one subsystem writing it twice.

  Settles proposal 034 §6.

- 199cfae: Refuse a build where `assetsTarget` or `virtualAssets` configures a facet the project removed.

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

- 5adf8d1: Fix a top-level `zintl()` in a `.tsx`/`.jsx` entry never receiving its catalog.

  CLAUDE.md defines an entry point as "a file with a **top-level** `zintl()` call". In a `.tsx` or
  `.jsx` project that shape did not work: given a module-scope anchor and any string in another
  boundary, the generated manager was built for a boundary id that named no chunk. It loaded with a
  200 and registered nothing, so the page rendered pseudo-localized in dev and untranslated in a
  build.

  Normalizing a boundary id — which extensions to strip — was implemented three times.
  `IOManager.getNormalizedId` keys the graph, `calculateSafeBoundaryId` mints the ids that reach
  emitted code, and both say the same thing: strip `.ts`/`.js` for stability across JS/TS moves, keep
  `.tsx`/`.jsx`/`.vue`/`.svelte`. The third copy, inside codegen, also stripped `.tsx`/`.jsx`. So the
  graph called a boundary `src/main.tsx` and codegen called it `src/main`.

  The fix is that copy's keep-list, now carrying a docblock naming the two implementations it has to
  agree with.

  **Two accidents hid it.** The strip regex is anchored at end-of-string, so a _function-scoped_ id
  (`src/main.tsx:boot`) has no trailing extension and matched the graph untouched — and every example
  wraps `render` in `bootstrap()`, which is exactly that case. And the keep-lists disagreed about only
  two extensions, so `.ts`, `.js`, `.vue`, `.svelte` and `.html` entries were all fine either way. One
  cell of six, reachable only through a shape no project used.

  It also needs a _second_ boundary: with every string in the anchor's own file the wrong id is used
  consistently on both sides and the page renders correctly.

  Guarded now by a matrix asserting that a manager's id names the chunk its boundary actually lands in
  — for each extension, at both anchor scopes — and by a contract fixture whose module-scope page is
  the one `initial-render` visits. Both were confirmed to fail with the fix reverted; the fixture
  reproduces the original symptom exactly.

  No output changed for any existing project: 30 projects across two hosts, 386 contract tests, zero
  snapshot diff. Emitted ids do move for a project with a module-scope `.tsx` anchor — those projects
  were broken, so this is the fix rather than a break.

  Written up, including the two things its own plan had wrong, in
  `docs/spec/proposals/036-one-boundary-id-spelling.md`.

- Updated dependencies [d1f0cd9]
- Updated dependencies [d1f0cd9]
- Updated dependencies [810ef00]
- Updated dependencies [0177060]
  - @zintljs/extractor@0.1.0-alpha.19

## 0.1.0-alpha.18

### Minor Changes

- 6aafef8: Add Preact, Solid and Lit — the three frameworks `create-vite` and `create-rsbuild`
  scaffold that Zintl did not support.

  Zintl's claim has been that another framework is additive work rather than a core rewrite. That was
  untested against anything the project did not write itself: of the eight templates `create-vite`
  scaffolds, four had no support at all. Three of them do now, on both hosts.

  **Preact** is the claim holding up. Its extraction is React's — both read one shared `JSX_TARGETS`
  list, because JSX is JSX — and it differs in exactly two declarations. The subscription hook comes
  from `preact/compat`, not `preact/hooks`. And re-running the entry is _safe_ here where it is not in
  React: `createRoot` mounts a second root over a container it already owns, while Preact's `render()`
  diffs against the tree already there. Measured before it was declared — seven consecutive entry
  edits, one `#center` throughout, with a `window` marker surviving to rule out a page reload.

  **Solid** is the claim being stretched, and it found a real defect. A Solid component runs once; its
  JSX compiles to fine-grained effects, so subscribing it has nothing to act on. It uses the
  `reactiveBridge` seam Vue already had, mirroring the store into a signal whose read is spliced into
  every `_t` call — so rendering a translation _is_ taking the dependency, and no sink can be missed.
  The observable result is the nicest in the suite: switching locale remounts nothing, and a counter
  keeps its value across two switches where every other framework example throws it away. Verified in a
  browser by marking DOM nodes before a switch and finding the same nodes carrying the new text.

  Solid's limit is on the other side, and is a property of Solid rather than a gap here: a component
  does not self-accept a catalog invalidation, so it propagates to the entry, and re-running a Solid
  entry is unsafe — `render(code, el)` called twice on one element leaves **two** children, measured.
  So a _translation-file edit_ arrives by reload and `solid-basic` claims no `hmr`. The template's
  `/* @refresh reload */` was the obvious suspect and was ruled out: removing it changes nothing.

  The defect it exposed: the compiler injected `useSyncExternalStore(...)` into any file with component
  functions, gated only on server components. Vue and Svelte escaped because their SFCs have no
  component functions to find — a property of their file format, not a decision — so the first JSX
  dialect _without_ a hook got a call to an undefined name. The injection is now gated on the framework
  having declared a hook to call, which is what the condition should always have been.

  **Lit** needed capability rather than configuration, and each addition is framework-blind:

  - `` tag:`<name>` `` in the extractor — "the contents of a template literal tagged with this
    identifier are markup". Lit's markup is neither a file format nor JSX but a tagged template inside
    an ordinary module, and neither existing seam reached it: an `sfcRules` entry for `.ts` would
    hijack every module in the project or leave the code around the template unextracted, taking the
    `zintl()` anchor with it. htm and uhtml get this from the same declaration.
  - `CodegenFacet.codegenImports` — what a dialect's _generated_ markup references. React's
    `dangerouslySetInnerHTML` and Svelte's `{@html}` are syntax; Lit's `unsafeHTML` is an import.
  - `CodegenFacet.wrapTemplateFragment` — how a `_t` call is interpolated into a surrounding template
    literal. `${…}` was hardcoded, which is right for a vanilla `innerHTML` template and wrong for Lit,
    where an interpolated string is deliberately rendered as text.

  Lit's limits are declared rather than papered over: `repaintsOnCatalogUpdate` is left undeclared,
  because repainting a live element needs a registry of connected components — a mixin, which is
  application code — and `lit-basic` claims no `hmr` capability as a result.

  Coverage is a real example app per framework on Vite plus an inline Rsbuild fixture, following
  `tests/manifests/index.ts`'s own guidance that cost is roughly (projects × matching contracts). The
  contract suite goes from 309 to 364.

  The three apps are scaffolded from `create-vite` — `preact-ts`, `solid-ts`, `lit-ts` — not
  approximated from a sibling example, which matters because the templates differ in ways that would
  otherwise have gone untested. `lit-ts` renders into a **shadow root**, keeps its whole stylesheet in
  a `css` tagged template, and slots its `<h1>` from `index.html`; `preact-ts` names its component
  `app.tsx` and writes `class` rather than `className`. `examples/lit-basic/src/my-element.ts` is the
  template's own file — diffed against a fresh scaffold, it differs only by this repo's formatter and
  one `@zintl-ignore` line, with no change to logic, structure or markup. That is the strongest form of
  the claim this change makes.

  Detection prefers Preact over React and resolves it after both scans, because `@preact/preset-vite`
  aliases `react` — a project resolving as both would activate two codegen facets claiming `.tsx`,
  which is a hard error by design. Solid is matched on separator boundaries so `splitVendorChunk` is
  not read as a framework, and Lit is detected from dependencies only, since it has no plugin on either
  host.

  Qwik remains unsupported: it is Vite-only, and resumability against a module-level reactive store is
  a question about the runtime rather than a facet.

### Patch Changes

- 1e41f7e: A boundary whose anchor has moved no longer re-enters the graph from the persisted manifest.

  Nested anchors are named for where they sit — `f_<offset>`, the offset of the `zintl()` call inside its
  script block — so editing anything _above_ the call renames the boundary. The old name survives in
  `.zintl`'s manifest as an empty key, and boundary-graph construction seeded its candidates from that
  manifest's keys, so the dead name came back as a node. The skip-empty guard could not stop it: that
  guard reads the **file's** dependencies, and the file still imports `zintljs/macro`, so a dead boundary
  inherited the pass-through rule written for intermediate modules.

  The graph therefore depended on when the machine last built. Adding a doc comment above `<script setup>`
  in the shared locale bar moved one anchor from 700 to 846 and left six ghost nodes in committed graph
  snapshots — invisible on any checkout whose manifest predated the edit, and red on CI, which builds one
  from `HEAD`.

  `buildBoundaryGraph` now requires the current extraction to attest a nested boundary before seeding it.
  Metadata is rewritten per file as that file is read, so it describes the source as it is; the manifest
  beside it does not. An unattested key that still carries strings is kept — a partial rebuild re-extracts
  one file and attests nothing about the rest, and dropping such a key would drop real translations — so
  only dead, empty names are refused.

  This is [L-055](https://github.com/zintljs/zintl/blob/main/docs/spec/proposals/027-leak-ledger.md)'s fix
  carried past virtual boundaries, which is where it stopped. See ledger L-082.

- 3bb8466: Extract translatable attributes from markup written inside a JavaScript template.

  An `alt`, `title`, `placeholder` or `aria-label` was extracted from an HTML document, from a Vue or
  Svelte SFC template, and from JSX — and **silently dropped** from the same markup written inside a
  JS template literal, which is how every vanilla app and every Lit component writes it. Nothing
  failed; the string simply never reached a catalog, so no translator ever saw it.

  It was live in one template localized six ways. `react-basic`, `preact-basic`, `solid-basic` and
  `vue-basic` all had `"Vite logo"` in their catalogs. `lit-basic` and the nine vanilla apps did not,
  from identical markup.

  **The cause** was that attribute extraction existed in exactly one place: a loop inside `extractHtml`,
  which runs only for `.html` documents and SFC template blocks. The JavaScript path —
  `findLiteralsInExpression` — called `stitchHTML` for text nodes and never looked at attributes.

  So the loop became `scanTranslatableAttributes`, in its own module because `context.ts` cannot import
  `html.ts` without closing a cycle, and both literal branches now call it. What made it shareable is
  that each caller already had the thing that differs: a function mapping an index in the markup to a
  source offset. An HTML document adds a constant; a template literal walks its quasis — and _refuses_,
  by throwing, for a range crossing an interpolation. The scanner reads that refusal as "skip", which is
  what keeps `src=${logo}` from being mistaken for a translatable string.

  **No new capability was needed**, because of one choice: inside a JS template the sink covers the
  attribute's **value**, not the whole attribute, and carries `isFragment`. The existing fragment path
  then drops a `${…}` between quotes that are already there —

  ```js
  el.innerHTML = `<img alt="${_t("Vite logo", …)}" />`;   // plain JS
  html`<img alt="${_t("Vite logo", …)}" />`               // a Lit quoted binding
  ```

  — which is valid in both hosts at once. `wrapHtmlAttribute` is correspondingly gated on `!isFragment`:
  it rewrites the attribute _and its name_, which is right for the whole-attribute form and would emit
  the name twice for a fragment.

  Attribute values containing an interpolation (`title="Hello ${name}"`) are skipped rather than
  mangled. That matches the paths that already worked — `.html` and SFC extraction both pass
  `variables: []` — so it stays one limitation shared by every path instead of becoming a per-path quirk.

  Eleven example apps now extract strings they were losing; the `.html` and SFC transform snapshots do
  not move at all, which is what says the lifted loop still behaves as it did on the path it came from.

- 4330499: Stopped Zintl reloading the browser over files nobody changed, which is what `syntax-recovery` was intermittently stalling on. Measured back to back on `vanilla-spa-basic`: **2/20 before, 0/20 after**.

  **A watcher report is not an edit.** `computeHotUpdatePlan` decided whether an event was Zintl's own by asking `isWritingFile` — a 500 ms window, and ZDB Corollary D1a says a window is never a guard. Used as one it failed in both directions. Instrumenting a single _passing_ run caught ten echoes of Zintl's own writes arriving with the guard already shut, at 118–209 ms against a nominal 500, because the timer is armed per write and an early write's timer closes the guard on a later one. And authorship was the smaller half: the event that actually stalls the contract is a report for a catalog **nobody wrote** — a worker copy settling, an initial scan draining — arriving seconds into the test.

  Either way the compiler marks the boundary dirty, and `index.html.<locale>.json` maps back to the `index.html` boundary, which the plan answers with a full page reload. Land that while the app does not compile and the page cannot come back: the entry fails to load, so there is no runtime and no module registered for it, and the recovery edit arrives as a hot `update` with nothing left in the page able to accept it. `vanilla-spa-basic` alone, because it is the only project whose edited file _is_ the client entry.

  So the question asked is now content, not authorship and not a clock: `IOManager` keeps a signature of what it believes is at a path — set by the first read, moved only by a write, and dropped once an event has been taken as genuine, so a real edit is never mistaken for a repeat. Each write also closes its own guard window rather than whichever one is open.

  **A repoint that only strips an extension is not a repair.** `getNormalizedId` strips `.ts`/`.js` from a boundary id, so the boundary for `src/main.ts` is `src/main` and `ViteUpdateApplier` repointed the module's `file` onto `<root>/src/main` — a path no file has. Vite could then no longer reach it from the file that changed, and the next edit arrived with `modules: []`, so Vite never dropped its own transform cache. This is ledger L-023's unexamined hypothesis, now measured and closed.

  **The diagnosis says who reloaded the page.** A `full-reload` in the ledger may be Zintl's or Vite's own, and those call for opposite fixes; Zintl's now records a `reload` trace entry. The stall report also carries the network requests it failed or never answered, and the whole console rather than its last four lines — the two things that turned this diagnosis from inference into reading.

- Updated dependencies [3bb8466]
- Updated dependencies [6aafef8]
  - @zintljs/extractor@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- 1b68c17: Fix the dev HMR snippet corrupting any module with `</script>` in a string, and close three
  dev-loop leaks from proposal 027's ledger.

  **The product defect (L-073).** In dev, the HMR snippet was spliced before the file's _last_
  `</script>`. That rule exists for SFCs, whose module code lives inside a script block — but it was
  applied to every file, so in a plain module it found whatever the source happened to contain. A
  server entry building its own document (`'<head>' + '<script src="/@vite/client"></script>' +
'</head>'`, which is what any SSR shell does) had the snippet spliced into the middle of the string.
  The module then failed the bundler's import analysis and the app served a 500 on **every request** —
  dev only, with a clean build, and with an error message pointing at the bundler rather than at
  Zintl. Where a file may legally hold injected code is now asked of the codegen facets rather than
  read out of the text, so a project with no SFC facet cannot take that branch at all.

  **Write attribution (L-071).** A flush has five independent reasons to write a catalog and the write
  could not say which applied. Each producer now tags what it schedules, and the tag reaches both the
  debug log and the `io/write` envelope. That immediately showed the write undoing the prune is
  tagged `dirty` rather than `recover-missing` — so a boundary the deletion scrubbed is back in the
  dirty set by the time the write pass runs. (The mechanism first inferred from that, an in-flight
  observation re-registering the boundary, was retracted a day later: it was teardown. See L-076.)

  **Harness (L-066).** `catalogContains` now waits on the compiler's dirty set before reading, reads
  through merged catalogs instead of comparing an object to a string, and takes an optional `value` so
  "a translator can find this key" is expressible. It had never been called, and could only ever have
  failed on the two merged-catalog projects. With it, `hmr-growth` asserts again that a new sink
  reaches disk — 0 failures in 10 runs, including the project the ledger recorded as never writing the
  key at all.

  **SSR examples.** All four `*-ssr` examples now hand their http server to Vite
  (`hmr: { server }`). In middleware mode Vite otherwise opens its HMR socket on a fixed port, so a
  second SSR app on the same machine silently receives no hot updates at all. This is what had made
  `react-ssr` unable to hot-update; it, and the three SSR examples that had never claimed the
  capability, now do.

- a6c2689: Reclaim every boundary a deleted file owned, and give the harness a filesystem trace.

  `removeFile` reclaimed only the boundaries `boundaryOwnership` listed for a file. A file that is an
  entry, or that carries an HTML projection, also registers a boundary under the bare file id — which
  that map does not list — so deleting the file left a graph node behind for the life of the process.
  Matching graph nodes by id as well closes it. Content-addressed ids are unaffected: they are not
  derived from a path, so the ownership map remains the only route to them.

  **Two diagnoses in the ledger are retracted by this pass**, and the correction is worth more than the
  fix. Both rested on reading the debug logger's `+Nms` — a delta since the _previous log line_ — as
  the time since a named event. Interleaved against the harness's own filesystem operations, the
  "residual writer re-registering a forgotten boundary" turns out to be **teardown**: `restoreAll` puts
  the file back and a boundary is registered for a file that exists, which is correct. A removal-epoch
  probe confirmed it independently — every such read began after the deletion, not during it.

  New in the testing package: `ZINTL_FS_TRACE` timestamps what the harness itself does to a project's
  files, so the compiler's log and the test's mutations can be read in one order; `boundaryForgotten`
  now reports _which_ graph node it matched instead of only that one existed; and the Rspack watch
  trace records removed files, not just modified ones, so "the host reported nothing" and "we dropped
  it" stop looking identical.

- d0fb628: Name the host's half of ZHMR §4.2's routing, and run the structural HMR path on six more projects.

  `hmr-structural` was claimed by two projects, so §4.1③ (a new sink) and §4.2 (a new anchor) had never
  run on Vue, on Svelte, or on Rspack — and §4.2 is the section whose two-route rule was written from
  that sample of two. Extending it to Vue and Svelte on Vite, and React, Vue, Svelte and vanilla on
  Rspack, found the missing input immediately.

  **`BundlerFacet.absorbsStructuralChange`.** §4.2 routed a structural change by asking the entry:
  where re-running it is safe, the re-executed entry rebuilds the boundary map in place. That is a
  framework fact, and it is not the whole answer — a new boundary is a new catalog chunk, and a host
  that answers a changed entrypoint chunk set with a full reload does so before Zintl is consulted.
  Measured: `plan.fullReload` is `false` for exactly the edits that reload on Rspack. The new flag
  defaults to `true`, is declared `false` by `rspackFacet`, and merges pessimistically like
  `entryReexecutionSafe`; the two compose into one question the contract asks once.

  **`hmr-warm` gates the no-reload claim.** The warm half of the structural contract was asserting a
  guarantee the contract did not require, so projects that reload for every edit — documented, measured
  behaviour since the capability was created — were failing it. That assertion is now its own contract,
  selected by capability rather than branched on inside one.

  No runtime behaviour changes for existing users; this names a host difference that was already there
  and was being attributed to the framework.

  - @zintljs/extractor@0.1.0-alpha.17

## 0.1.0-alpha.16

### Minor Changes

- 6a3d1b8: Fix Vue on Rsbuild, and rebuild the Rsbuild examples as `create-rsbuild` starters across all four frameworks.

  **The fix.** Vue on Rsbuild built green and shipped the source locale. Extraction, catalog scaffolding, `verifyIntegrity`, chunk alignment and the HTML projection were all correct — only the code generation was missing, so a page rendered English under a Spanish `<title>`. The cause was one skip in Zintl: `hooks/transform.ts` ignored every id containing `?vue`, which is right on Vite (that id names a virtual module holding one block of the SFC) and wrong on Rspack (`vue-loader`'s pitcher rewrites it into a request that re-reads the whole file). Zintl was transforming the parent request, which is discarded, and skipping the block requests, which become the code.

  Whether a block request carries the whole file is a fact about the **bundler**, so it is now a bundler-facet declaration — `BundlerFacet.sfcBlockRequestsCarryWholeFile`, `true` on `rspackFacet`, undeclared on `viteFacet` — and `hooks/transform.ts` asks it instead of matching a query string. Vite's behaviour is unchanged by construction. Written up as L-051.

  **The examples.** The two Rsbuild examples were never written to be examples: they grew out of proposal 026's falsification harness and were Vite's starter with the branding torn out, with names (`rsbuild-spa` = vanilla, `rsbuild-react` = no pattern) that did not say what they were. They are now `rsbuild-<framework>-<pattern>`, and each reads as "I ran `pnpm create rsbuild`, then added localization": the page, the CSS and the mount point are the template's, and what is added is the four-locale switcher, `?lang=`, the catalogs, and the `index.html` Zintl needs to localize `<title>` and `<html dir>`.

  Renamed: `rsbuild-spa` → `rsbuild-vanilla-basic`, `rsbuild-react` → `rsbuild-react-basic`.

  New, each in the contract suite with capabilities earned one contract at a time:

  - **`rsbuild-vue-basic`** — the app that found L-051 and now guards the fix.
  - **`rsbuild-svelte-basic`** — Svelte 5 on Rspack; it needed no Zintl change at all.
  - **`rsbuild-vanilla-spa`** and **`rsbuild-vue-spa`** — a hand-rolled router and `vue-router`, each with a lazy `await import()` route, so catalog splitting on Rspack is demonstrated for a boundary the entry never imports statically.
  - **`rsbuild-vanilla-mpa`** and **`rsbuild-vue-mpa`** — two `source.entry` keys, two HTML templates, and a shared component that anchors itself. The first projects on either host to drive Zintl's multi-entry HTML path, which `hooks/html.ts` was written for and nothing had run.

  The support statement moves with the evidence: Rsbuild now covers all four frameworks, single-page and multi-page, in build and dev. `multiplex` and SSR remain Vite-only.

  **Two limitations found on the way, both documented rather than fixed.** Vue's Options API has never worked on either host — a plain `<script>` compiles its template into a separate render function where the helpers Zintl injects are not in scope, and the render throws `_ctx._t is not a function`; every Vue example here uses `<script setup>`, which is why it had never surfaced (L-053). And an inline arrow in a Svelte event attribute on an element with extractable text makes the stitched unit start inside the attribute, producing unparsable output — also on both hosts.

  Also here: the `hmr` capability is not claimed on the new projects, and the reason is measured rather than assumed — an edit to a string in a boundary the runtime has to _fetch_ loses the race with the catalog write when the page full-reloads (10 failures in 10 on Svelte, against React and vanilla passing 10 in 10 in the same batch).

  Two build-snapshot stability defects were found and fixed on the way, both of which had first been read as flake. `examples/rsbuild-svelte-basic` pins Svelte's `cssHash`, whose default hashes the absolute filename and made its snapshot depend on which test worker copied the project (L-052). And `@zintljs/testing`'s `sanitizeCode` now normalises `clonedRuleSet_N`, which `VueLoaderPlugin` numbers from a module-scoped counter that accumulates across every Vue project a worker compiles (L-054).

  Documentation that described Rsbuild as an unsupported falsification target has been corrected in four places, and the `18 example apps → 72 contract tests` counts, already stale, are now 27 and 199.

  **The performance gate was failing on machine state, and now scales properly.** `vpr bench` had started reporting regressions that were not there: on one laptop, `Structural HMR Latency` measured 0.44 ms against a recorded 0.2139 ms and `Colony HMR Latency` 0.75 ms against 0.4124 ms — on identical code, verified by building the original commit in a worktree and running it alongside. The machine had 14 GB of 15 GB swap in use. The calibration that exists to absorb exactly that could not see it, because it was a `Math.sin` loop: it stays in L1, allocates nothing, never provokes the collector, and reported the machine 1.00× while every allocation-heavy path had halved in speed.

  Four changes came out of it. The calibration workload now allocates a working set large enough to touch fresh pages, builds strings, sorts and serializes, so it degrades with the resources the benchmarks depend on — its size mattered as much as its shape, since a first attempt at 48 short-lived strings never grew the heap and so missed `Extract Long File`, which builds a large native AST, entirely. Across the suite that took normalised ratio spread from 54–121% down to 1–9%. Budgets are expressed as multiples of that calibration rather than as milliseconds plus a separate reference constant, so there is no second number to keep in step and nothing to drift apart from. The comparison moved from the mean to **p75**, after a run where `Fast-Path (No Translations/Sinks)` reported mean 0.1183 ms against p75 0.0549 ms and max 16.3 ms — two stalled iterations moved the mean by 2.2× and failed the gate while p75 sat comfortably inside it. And `vpr ready` now runs the benchmark **second**, right after the package build, instead of last: measured after 27 example builds, a type-aware lint and 800 tests, the same benchmark reads 3.4 ms where it reads 0.5 ms run early.

  A budget failure now also prints the calibration reading and says to check swap before concluding the code regressed, and a missing calibration is a hard failure rather than eight meaningless violations against zero. `vpr ready` went from failing roughly every other run to four consecutive passes.

  **Example typechecks are wired into the gate**, which immediately paid for itself. The Vue and Svelte Rsbuild examples built with a bare `rsbuild build` and their `check` script was run by nothing, so two defects had shipped: `rsbuild-vue-mpa` carried a real type error (`SiteHeader.vue`'s top-level `await` needs `module: es2022+`, which `create-rsbuild`'s Vue tsconfig does not set — swc compiled it happily, `vue-tsc` did not), and `rsbuild-svelte-basic`'s `check` had never worked at all, reporting every component as `Error in vite.config` because `svelte-check` falls back to hunting for a Vite plugin when it finds no Svelte config. Both fixed; the typecheck now runs inside `build`, matching the Vite peers, and verified to fail a deliberately introduced error. `examples/svelte-basic` had the same ungated hole on Vite and is wired the same way.

  **ICU plurals are now exercised on Rspack.** No Rsbuild example touched grammar compilation — only `examples/website` did, on Vite — so ICU on this host was an inference from "baking happens in the compiler". `rsbuild-vanilla-basic`'s catalog now carries real plural forms, in the documented shape: the source stays `` `Count is ${counter}` `` and the grammar lives in the catalog. The emitted Arabic chunk is a native `Intl.PluralRules` call and a conditional chain, with identical branches folded and no parser in the bundle. Clicking the counter in Arabic walks `zero → one → two → few`.

  Also measured and recorded: `hmr` on the four newest projects. `rsbuild-vanilla-mpa` passes the HMR contract 0 failures in 10 — the heading is in the entry's own inlined boundary, so the reload comes back with the text already there — but cannot claim the capability, because `delivery-ordering` and `delivery-refresh` are gated behind it and abort on a contract assumption (they look the heading key up in `catalogs[activeLocale]`, where the entry's own boundary is inlined rather than registered under the ghosted source locale). `rsbuild-vanilla-spa` and `rsbuild-vue-spa` fail 10 in 10 and `rsbuild-vue-mpa` 8 in 10, all the empty-render reload race. Each manifest carries its own number.

- 5d8f4d4: Vue components written with the Options API now work, on Vite and on Rsbuild alike.

  A plain `<script>` component compiles its template into a separate render function whose expressions
  resolve against the component instance — so the `_t` and manager bindings Zintl injected into the
  script block were not in scope, and the page rendered empty with `_ctx._t is not a function`. The
  build was green, the catalogs were correct, and only the browser could tell. Every Vue example in this
  repository used `<script setup>`, which is why it went unseen (ledger L-053).

  Zintl now authors the `<script setup>` block the component lacks, beside the one you wrote rather
  than instead of it. Vue compiles the two together — the added block's imports are hoisted to module
  scope and your `export default { data, methods }` remains the options object — so nothing about your
  component changes, and its `lang` is mirrored exactly, because Vue rejects two script blocks whose
  languages disagree.

  Three shapes cannot take the extra block, and now fail the build with a message naming the reason
  instead of rendering an empty page: a `<script src="…">`, a `<script lang>` that is not JavaScript or
  TypeScript, and a component that already declares its own `setup` option (Vue would silently replace
  it). The refusal is deliberately narrow — it fires only when a _template_ string needs an injected
  binding, so a component whose strings live in its script block, and any baked (`zintl("fr")`) build,
  are untouched.

  Where this lands in the facet contract: `CodegenFacet.requiresScriptSetup` is how a dialect declares
  that its templates resolve against the component instance. Vue declares it; Svelte does not, because
  its `<script>` is the component scope. `wrapSfcScript` gains an optional `{ lang }` so an authored
  block can match one that already exists. The compiler core learns nothing about Vue — it asks the
  facet.

  `examples/vue-basic` and `examples/rsbuild-vue-basic` each gained an Options-API component, verified
  in a real browser in all four locales in dev and in a production preview.

### Patch Changes

- a6d0820: Editing a localized asset now updates the page (ZHMR §5).

  It never did, on either host, and the same symptom had three independent causes stacked on top of
  each other — fixing any one alone changed nothing visible, which is why the section survived being
  specified and implemented for as long as it did.

  **The compiler never re-read the file.** Asset text lives in the hive, and only `syncGraphs()`
  refills it. The asset branch of `invalidateFile` announced the affected boundary and scheduled a
  flush — both about delivery — without marking the graph dirty, so the whole cascade ran correctly
  against the previous contents of the file.

  **The text lived in a second module neither host would rebuild.** The generated catalog held an
  imported binding rather than the text, and that import is minted under an extension-free virtual id
  so no host can misclassify it by extension. A virtual module has no file, so Vite's graph cannot
  associate it with the changed asset, and Rspack has no declared dependency to call it stale. In
  development the text is now inlined into the catalog, which deletes the second module instead of
  trying to synchronise it across two mechanisms that share nothing. Production keeps the import, where
  one shared module per asset is right; the dev-transform snapshots move by exactly that substitution
  and the production snapshots are untouched.

  **The correct catalog was delivered and then rejected.** With the above fixed, the rebuilt catalog
  carried the right text and the same generation as the one already applied, so the runtime discarded
  it by Axiom D1 — the most misleading of the three, since every component was behaving correctly. An
  asset edit now advances `catalogGeneration` like any other change.

  `ContentFacet.getDeclaredInputs` is new: a virtual boundary is contributed rather than extracted, so
  `boundaryOwnership` cannot say what it derives from, and it therefore declared no inputs at all. A
  facet can now name the files behind its virtual boundaries, which is what makes a generated catalog
  go stale on a host that rebuilds from declared dependencies.

  Ledger L-067. `[Asset HMR] assets-basic` is green on both halves — the translator's edit to
  `about.ar.txt` and the developer's edit to `about.txt`. On Rspack the failure has moved rather than
  gone: store and DOM both carry the new text seconds after the edit, and a later rebuild restores the
  old one, which is L-064's reload-beats-the-catalog-write shape rather than an asset defect.

- 05b34f8: A production build no longer inherits a dev-only virtual boundary from its own persisted metadata.

  `b_assets` — the boundary that carries localized assets — is synthesized in dev only. But the dev
  synthesis is written into `.zintl`'s manifest, and boundary-graph construction seeded its candidates
  from that manifest's keys, so a build that happened to read a dev-written manifest grew a `b_assets`
  node through the ordinary node path. Two builds of identical source could therefore produce different
  boundary graphs, decided by whether a dev run had touched the project first.

  `buildBoundaryGraph` now skips virtual boundaries when seeding candidates outside dev, so the graph is
  a function of the source rather than of what ran before it. Dev is unchanged and still synthesizes the
  node with its own distinct shape. See ledger L-055.

- 6edeca3: A hot catalog update is no longer accepted by a page that cannot redraw from it.

  On Rspack, editing a translation reached the browser and vanished. Measured in the page: the store
  held the new translation and the heading held the text painted before the edit, indefinitely. This
  had been recorded as a race — "the reload beats the catalog write" — and there is no race. The
  catalog arrives, applies, and nothing asks the page to paint again.

  Two conditions have to hold together, which is why it looked host-specific and framework-specific by
  turns. Nothing in the page is subscribed to the store — a vanilla entry and Svelte's compiled output
  each paint once — _and_ the host does not re-run the entry either, because Rspack's applier
  deliberately invalidates nothing and rebuilds only what its declared dependencies mark stale. Vite's
  applier invalidates the entry's own modules, which is why the same projects were always green there.

  A generated catalog now self-accepts only when something can act on it. `BundlerFacet.hmrSelfAcceptCode`
  takes a `canRepaint` argument; Vite ignores it, and Rspack declines. Declining alone is not enough,
  because a fetched catalog arrives through a dynamic import — a chunk boundary with no static parent —
  so it does not bubble to a reload the way declining inside an entry does; the update plan therefore
  issues the reload from that same facet answer, so the module and the server cannot disagree.

  `RuntimeFacet.repaintsOnCatalogUpdate` is new: a framework states whether its components redraw from
  a store update. It defaults to `false` where `entryReexecutionSafe` defaults to `true`, because a
  wrong `true` here yields a page that silently lies about its own contents while a wrong `false` costs
  a refresh.

  Ledger L-064. Catalog edits now apply on `rsbuild-vanilla-basic`, `rsbuild-vanilla-spa` and
  `rsbuild-svelte-basic` — by reload, the same trade L-035 made for source files — while
  `rsbuild-vue-mpa` keeps its warm path. Still open: the reactive frameworks whose managers _fetch_
  rather than inline the catalog, which is L-056's inlined-vs-fetched line rather than anything about
  frameworks.

- 8064f19: A flush deferred by another flush now gets a trigger of its own.

  `flush()` hands a mid-flush caller the in-flight promise and settles `dirt retained for the next`,
  justified by "the debounce timer is already scheduled by the `transform` that dirtied it". That holds
  for every trigger except the last one: `scheduleFlush()` _replaces_ the timer, and when it fires
  `flush()` clears it, finds a run already in flight, and returns — leaving nothing scheduled. If no
  further change arrives, the retained dirt is never flushed at all.

  Measured on a boundary rename: two flushes, one catalog prune that ran _before_ the rename, and a
  catalog write that simply never happened. The signal for it,
  `flush #N → superseded (joined the in-flight flush; dirt retained for the next)`, appears 68 times
  across one session's captured diagnoses and had been read as background noise throughout.

  `armTrailingFlush` re-arms the **debounce timer** once the in-flight run settles, rather than running
  a follow-on flush. That is the difference from the two attempts this replaces: further changes
  coalesce into the timer, so a burst costs one extra pass at the end rather than one per update. It
  cannot livelock, because nothing is armed unless dirt actually remains, at most one arm exists per
  in-flight run, and a trailing flush that leaves the dirt unchanged does not arm another — while a
  real edit clears that guard so genuine work is never refused. `hmr-hammer`, the contract the earlier
  follow-on destabilised, measures 0 failures in 10 runs.

  `noOrphanedCatalogs()` needed fixing to see any of this: it read the filesystem the instant the DOM
  settled, mid-way through work already scheduled. Awaiting `flush()` once is not enough either, since
  a mid-flush caller receives the in-flight promise. `flushUntilQuiescent` loops on the dirty set
  rather than a clock, so it terminates because there is no dirt left rather than because time passed.

  `[Chaos Boundary] vue-basic` passes 10 runs in 10. `svelte-basic` stays pending for an unrelated
  defect the shared skip had been hiding — proposal 024 §1.3's double mount, measured 6/10 under
  contention and 0/10 in isolation.

- eca2c86: Deleting a boundary no longer queues its catalogs to be written back.

  `removeFile` marked each removed boundary dirty. "Dirty" means _write my catalog_, so marking a
  boundary that has just been deleted queued its catalogs for re-creation — and the prune, running
  earlier in the same flush, had its work undone a millisecond later:

  ```
  Pruning orphaned file: zintl/src/App.svelte.ar.json   +0ms
  Writing file:          zintl/src/App.svelte.ar.json   +0ms
  ```

  The flag was added for a real reason — a deletion during an idle moment must not sit unflushed — and
  that job is already done twice over, by the explicit `scheduleFlush()` at the end of `removeFile` and
  by the trailing flush a deferred flush now arms. Waking the flush and asking it to write are
  different jobs, and only the first was ever wanted here. The removed boundary is now scrubbed from
  the dirty set rather than added to it, and the unit test asserting the old behaviour is rewritten
  rather than deleted, since its intent was right and only its mechanism was backwards.

  Measured on `chaos-boundary`: `svelte-basic` goes from 5 failing runs in 10 to 2. The prune itself was
  never wrong. A second writer remains and is recorded in ledger L-071 with the next probe named rather
  than guessed — `Forgetting deleted file: src/AppNew.svelte` appears mid-test for the file the rename
  just created, and a boundary that is forgotten and re-extracted can be reconciled back onto the old
  id by content.

  No new instrumentation was needed to find this: `safeWriteFile` already logged every write through
  the same logger as the prune's decisions. Nobody had read the two in order.

- 8064f19: Every exit from catalog pruning now reports why.

  `pruneOrphanedBoundaries` had three silent paths out and one that logged. "The prune did not delete a
  file" therefore had at least four indistinguishable causes from outside — it never ran, the `prune`
  option is off, development sessions skip it by design, the known-path set was unchanged, or it ran
  and considered the file live. Ledger L-065 spent an investigation on that ambiguity and reached the
  wrong conclusion twice.

  All of them speak now, at debug level and — for the two that were already reported to the delivery
  bus — consistently with each other. The per-file decisions log too, `Pruning orphaned file:` beside a
  new `Keeping (known):`, because when the survivor is a catalog whose source was deleted, _which_
  seeding step claimed it is the whole question.

  This is instrumentation, not a behaviour change: no file is pruned or kept differently.

  What it immediately found is recorded as ledger L-070. The prune is not the defect — it runs once,
  correctly, and is then never asked again, because a flush that arrives while another is in flight is
  deferred to "the next trigger" and the last change before a quiet period has no next trigger. That
  signal, `flush #N → superseded (joined the in-flight flush; dirt retained for the next)`, appears 68
  times across this session's captured diagnoses and had been read as background noise throughout.

- e34d412: Hot updates on Rspack no longer render new source against an old catalog.

  Editing a translatable string in a boundary the entry does not own left the page blank for that
  string: the reloaded page re-executed with the **new** message key while the catalog it read still
  held the old one, and Zintl has no source-locale fallback by design, so the element rendered empty and
  nothing repaired it. Measured directly rather than inferred — after an edit, the dev server served a
  **byte-identical** manager chunk and a byte-identical content chunk, while the source module and the
  catalog files on disk had both updated correctly.

  Two independent faults in the same declaration, and either alone was enough:

  - The catalog dependency was built from a **safe** boundary id (`b_src_pages_Home_Home`) where
    `getCatalogPath` expects a **normalized** one (`src/pages/Home:Home`), so it named
    `<outputDir>/b_src_pages_Home_Home.<locale>.json` — a file no flush will ever write. Rspack accepted
    the dependency, found nothing, and the generated module was never stale. The same two-kinds-of-string
    confusion as ledger L-026, one layer along.
  - A chunk declared inputs only for the boundary it is _named after_, while embedding the catalogs of
    every boundary it contains. An entry chunk carrying a component's catalog never watched that
    component's source.

  Generated content and manager modules now declare the inputs of every boundary they embed, and the
  declaration is unioned with what that module has declared before — a boundary that drops out while its
  file has a syntax error must still be able to come back, and deriving the watch set from current
  contents alone would have stopped watching the file whose repair returns it.

  Vite is unaffected by construction: these declarations are gated on `dependencyInvalidation`, which
  only Rspack declares. See ledger L-057.

- 4925f0d: Store subscribers now follow the active store instead of being stranded on the one it replaced.

  `subscribe()` resolves through `getActiveInstance()`, which falls back to a module-level default
  store until something calls `setActiveInstance`. Anything that renders before the entry's `zintl()`
  resolves therefore subscribes to _that_ store — and the swap reassigned the pointer without taking
  the listeners with it. The subscription survived, aimed at an object nothing would ever notify again.

  Measured on `rsbuild-react-basic` after a catalog edit: the store held the new translation, `notify()`
  had run twice, and `listeners` was `0` with React's `useSyncExternalStore` demonstrably mounted. The
  consequence is invisible until something arrives that only a subscriber could act on, which is
  exactly what a hot catalog update is.

  `I18nStore.adoptListeners` moves them across on the swap and notifies once, since a subscriber whose
  store changed underneath it has by definition missed a snapshot.

  This is host-neutral runtime code that could only be observed on one host: Vite's applier invalidates
  the entry's own modules on every boundary update, so React remounts and re-subscribes and the strand
  is repaired constantly by a mechanism that exists for another reason. Rspack's applier re-runs
  nothing, so it is permanent.

  Ledger L-068. `[Catalog Edit] rsbuild-react-basic` passes. Vue is unaffected and remains open for a
  different reason: its templates call `_t()` directly, which is not a reactive dependency, so nothing
  re-renders on a new catalog — a missing reactivity bridge rather than a stranded subscription.

- d04b7d6: Vue components now redraw when a new catalog arrives.

  They never did. `_t('…')` is an ordinary call to an ordinary function, and Vue re-renders on reactive
  dependencies it read during render — so a delivered catalog was invisible to a Vue template by
  construction. Nothing was broken; a capability was missing. It stayed hidden because Vite's applier
  re-runs the entry on every boundary update, remounting the tree for unrelated reasons, and because a
  manager that _inlines_ its catalog updates the entry anyway. Only a fetched catalog on Rspack left
  nothing to re-run.

  `CodegenFacet.reactiveBridge` is new, and it contributes two halves because either alone is
  insufficient — a component can be perfectly subscribed and still never redraw if nothing it
  _rendered_ was reactive:

  - `setup` establishes a `shallowRef` seeded from `getStoreVersion()` and kept in step by a
    `subscribe()` whose unsubscribe is handed to `onScopeDispose`, so instances do not leave listeners
    behind.
  - `read` is spliced into every generated `_t` call as `_v: __zintl_v.value`, so rendering a
    translation _is_ reading the handle. Splicing at the call site rather than asking the codegen to
    find its own sinks is what makes it total, and `_t` ignores options it does not know, so a dialect
    without a bridge is unaffected.

  **A latent render loop is fixed alongside it**, because the bridge closed the circuit on one already
  present. `_t` triggers a hydration load when a key is missing and re-reads immediately, which is what
  lets a synchronous loader satisfy the first render tick. When the key is genuinely absent, every
  render triggered another load, every load could `addCatalogs`, and every `addCatalogs` notified —
  open with nothing subscribed, closed the moment a framework read the store during render. Measured at
  167,280 console messages in one `chaos-catalog` run, which deletes the catalog on purpose. React's
  recorded version of this is ~700 messages in twelve seconds.

  `I18nStore.claimHydrationAttempt` allows one attempt per locale/boundary/**key**, never cleared.
  Keying on the boundary and clearing on catalog change was tried first and re-armed the loop exactly:
  the load does deliver the boundary, it simply does not contain that key. Keying on the key is what
  makes "never cleared" safe — the guard gates only the miss path, and a key that later arrives is no
  longer a miss.

  Ledger L-069. `[Catalog Edit]` is green on all twelve claimants across both hosts.

  - @zintljs/extractor@0.1.0-alpha.16

## 0.1.0-alpha.15

### Minor Changes

- 8d8f942: Fixed client reactivity never being injected into plain React apps (ledger L-032), which also fixes the empty-render defect on Rspack (L-030) for framework apps.

  **The gate asked the wrong question.** `useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion)` was injected only into files where `observation.isClientComponent` held — and that is literally `code.includes('"use client"')`, a React Server Components directive. A plain React SPA never writes it, so no component in `react-basic`, `react-ssr` or a React app on any host subscribed to the store at all. Exactly one file in this repository carried the directive.

  `RuntimeFacet.serverComponents` now decides it, declared `true` only by the Next.js runtime facet. Where a framework separates server components from client ones, the directive still gates injection; everywhere else every component is a client component. Both the import gate and the injection gate move together, so a file cannot import a hook it never calls.

  **A second defect was hidden behind the first.** `registerComponentFunction` marked the outermost function containing _any_ JSX, with no name check — so a `bootstrap()` that merely calls `createRoot(el).render(<App />)` was treated as a component. Enabling the gate turned that into `Invalid hook call` and a blank page. It now requires a capitalised name, from the declaration or the binding an expression is assigned to, which is React's own rule; an unnamed function is not marked, because failing to subscribe degrades a repaint while a hook in a non-component breaks the app.

  **Why this mattered beyond React.** On Vite the missing subscription had no visible consequence — its module ordering makes the first render correct, so nothing ever needed repainting. On Rspack a catalog can arrive after the render, and with no subscriber the page stayed permanently blank. `examples/rsbuild-react` now claims `hmr`.

  Generated React output changes: components gain a `useSyncExternalStore` call and the corresponding imports.

- 9604cbd: Fenced ledger L-022: combining `multiplex: true` with a bundler that has no HTML fan-out support now fails fast with a clear `[Zintl] Multiplex is not supported...` error, instead of an opaque `html-rspack-plugin` loader-chain crash on Rspack/Rsbuild.

  Under multiplex (per-locale HTML fan-out), `loadIncludeHook` claims `.html` on the assumption that `loadHook` will serve it — true on Vite, where the fan-out is implemented, and fatal on Rspack: unplugin retypes the claimed template as `javascript/auto`, and the build dies inside `html-rspack-plugin`'s child compilation parsing `<!doctype html>` as JS.

  `BundlerFacet` gains `htmlFanOut?: boolean` — declared `true` on `viteFacet`, deliberately left undeclared on `rspackFacet` — following the same "ask the facet, don't test the bundler string" pattern ledger L-004 established for `isVirtualId`. `host.ts::ensureCompiler` checks the resolved capability against `ctx.getMultiplex()` before constructing the compiler, so the fence fires once, before any module resolution, on every host.

  The real HTML fan-out for Rspack remains undesigned and out of scope (026 §7, 027 §6) — this only replaces a crash with a loud, actionable error. Verified against a real `zintljs/rsbuild` build via a new fixture and contract (`tests/fixtures/multiplex-rsbuild-fence.ts`, `tests/contracts/multiplex-fence.contract.spec.ts`, capability `"multiplex-fenced"`).

- 3bdcea8: Framework detection no longer guesses React when it finds nothing (ledger L-034).

  `detectFrameworksOrFallback` returned `FALLBACK_FRAMEWORK` — `"react"` — for any project where neither the bundler plugin names nor `package.json` named a framework. That was not a neutral default: a project with no React dependency was assembled with React extraction and codegen, and because `reactCodegenFacet` is the only preset declaring `clientReactivityImports`, every project in existence reported having client reactivity. It also meant any runtime constraint attached to the React facet reached every framework-less project, which is why one previous attempt to mark React's entry re-execution unsafe had to be reverted.

  **What the guess was carrying was two extraction targets.** `obj:field:title` and `obj:field:text` were listed by `reactExtractionFacet` and not by `vanillaFacet`, so framework-less projects using those object fields had been depending on React extraction they never asked for. Both are plain object-field extraction with nothing React-specific about them, and they now live on the vanilla facet, which applies to every project.

  **Breaking:** `zintljs/facets` no longer exports `FALLBACK_FRAMEWORK` or `detectFrameworksOrFallback`. Use `detectFrameworks`, which returns an empty array when nothing matched — a real answer rather than a prompt for a guess. A project that uses a framework should declare it in `dependencies`/`devDependencies` or through its bundler plugin, both of which detection already reads.

- b5b5a3d: A non-reactive entry no longer claims it can hot-replace itself on Rspack (ledger L-035), which closes the empty-render defect for vanilla apps.

  `RuntimeFacet.entryReexecutionSafe` asks whether re-running an entry is _harmless_. Nothing asked whether it is _sufficient_, and on Webpack those differ: a re-executed entry reads its imports from the module cache, so it can seed a fresh store from a manager that has not been replaced yet. A framework app survives that — a subscribed component repaints when the catalog lands a moment later. An app with no client reactivity has only the re-execution, so it rendered empty and stayed that way.

  `BundlerFacet.hmrInjectionCode` now receives a `hasClientReactivity` argument, and `rspackFacet` requires it alongside `entryReexecutionSafe`. A non-reactive entry declines to accept, the update bubbles, and the page reloads — slower than a hot update and correct, which is the trade `viteFacet` already makes for frameworks whose mount is not replayable. Vite ignores the argument, because re-importing an entry there re-fetches the whole dependency chain and re-execution is always sufficient.

  `examples/rsbuild-spa` claims `hmr` and `hmr-stress` again.

- 778e1d5: Rsbuild is now a supported target for SPA builds **and dev-time hot updates**. Editing a string under `rsbuild dev` updates the page without a reload, on the source locale and on lazily-loaded ones alike.

  Proposal 028 §6 had refused promotion for a structural reason rather than a bug count: HMR was the one bundler concern not mediated by a facet — its orchestration lived inside the plugin's `vite: {}` escape hatch, and that it never ran anywhere else was an accident of unplugin dropping that block. Proposal 029 builds the seam:

  - **`HostUpdateApplier`** (`packages/zintl/src/hmr/`) splits the hot-update path along the line 028 §6.1 drew: `hmr/plan.ts` decides what changed using only host-neutral compiler calls, and each host's applier applies that decision in its own vocabulary. Vite's `ModuleGraph` surgery moves there unchanged. Appliers are _contributed_ by each host's escape hatch, never selected — there is no `switch (bundler)` in the hot-update path.
  - **`BundlerFacet.hotUpdate`** is the facet's half: the declaration that a bundler has an applier, visible to the composition guardrail and to a registration fence. Distinct from the existing `hmr` flag, which only says acceptance code is emitted.
  - **`BundlerFacet.dependencyInvalidation`** captures the deeper difference the work uncovered. Vite's hot-update hook _asks_ what to invalidate; Rspack asks nothing and rebuilds whatever its own dependency graph says is stale. So on Rspack the generated catalogs declare what they are derived from (`ZintlCompiler.getBoundaryInputs`) and are rebuilt in the same compilation as the edit. Declaring the same dependencies on Vite is not redundant but harmful — it makes Zintl's own catalog writes re-enter as source changes — so `viteFacet` deliberately does not.
  - `rspackFacet` now emits real acceptance code via `import.meta.webpackHot`. It ignores `hmrSelfAcceptCode`'s callback argument on purpose: Webpack treats that callback as an **error handler** and re-executes the module body instead, so Vite's shape would have silently registered catalog re-registration as a handler that never fires.

  **A latent runtime defect on Vite, surfaced by the second host (ledger L-028).** The receiver had two ways to load a boundary and only one of them published what it was doing: `registerLoader` (which a generated manager runs as it evaluates) tracked its async load in `pendingBoundaries` only, while `loadLazyBoundary` joins concurrent loads through `inFlight` — and tested "already loaded" _before_ "already loading". A pull arriving during a push was therefore handed the stale catalog and returned in zero milliseconds. Because Zintl has no source-locale fallback, every key that existed only in the incoming catalog rendered as blank text that nothing later repaired.

  Vite never showed it: it re-imports the whole dependency chain with a fresh `?t=`, so the content module applies before the entry re-renders. Rspack re-executes the manager and the entry as independent modules, so the two genuinely interleave. `registerLoader` now publishes its load in `inFlight`, and `loadLazyBoundary` checks for an outstanding load before answering from what it holds — a load is outstanding precisely because something decided the present catalog needs replacing. Guarded by a new `delivery-refresh` contract that drives the interleaving deliberately rather than waiting for the race: five projects fail without the fix and pass with it, four of them Vite.

  Also fixed, all found on the supported path (ledger L-024 – L-027): the dev/build discovery gate was keyed on a Vite-only field, so every Rsbuild rebuild re-discovered the whole project; four hardcoded `import.meta.hot` literals in the asset branches bypassed the bundler facet; boundary inputs were reported as normalized ids rather than real paths; and discovery needed to share its in-flight promise rather than a flag, since `buildStart` is a parallel hook on Rspack.

  `@rsbuild/core` is now declared as an optional peer dependency (tested against `^2.1.0`); `vite` becomes optional too, since neither is required. `multiplex` (per-locale HTML fan-out) and SSR remain Vite-only, and `multiplex` is now documented as a permanent exclusion rather than a pending one.

### Patch Changes

- 97b4a72: Stop a hot update from wedging the browser tab.

  `_t` resolves a missing key by triggering the boundary's load and re-reading it in the same
  expression, because after a hot update the new catalog is available on that very tick — the manager
  inlines the anchor's locale, so the load completes synchronously. That is wanted. What was not wanted
  is the announcement travelling with it: `_t` runs during render, so notifying subscribers there is a
  `setState` during render. Every re-render ran `_t` again and announced again, and the page ended up in
  an unbounded update loop — measured at roughly seven hundred React errors in twelve seconds, with the
  tab unresponsive.

  Applying and announcing are now separate. `addCatalogs` stays synchronous, so the re-read still works;
  `notify()` defers to a microtask and coalesces, so a burst announces once, after the caller's turn.
  The store's `version` moves inside that microtask too — it is React's snapshot, and a snapshot that
  changes mid-render makes React re-render to reconcile it, which would re-arm the same loop more
  quietly.

  Subscribers are therefore notified a microtask later than before. Nothing waits on that synchronously
  except tests, which now await a tick.

- 8d4c472: Stop invalidating a boundary whose source could not be parsed.

  When a hot update re-extracts a changed file and the parse fails — a file saved mid-keystroke, which
  is the most ordinary input a dev watcher sees — the failure was logged and then ignored: the file's
  boundaries were marked dirty, their catalog caches dropped, their revisions bumped, and
  `catalogGeneration` advanced. All of those assert that new content was read, on the strength of
  content that could not be read at all, and `catalogGeneration` is what the runtime uses to decide that
  an arriving catalog is newer than the one it holds.

  A parse failure now leaves the boundary exactly as it was and records the outcome on the delivery bus,
  so "left alone because its source could not be read" stays distinguishable from "invalidated". The
  next parseable edit re-extracts normally.

  Invisible on Vite, where the next edit re-extracts and the whole module chain is pushed fresh; it
  surfaced when Rspack's watch hook began handing unparseable files straight to invalidation.

- 8d7ff57: Stop a hot update from double-mounting a React entry.

  Two defects produced one symptom, and both are fixed.

  A sibling stylesheet was being repointed onto its component in Vite's module graph: the fallback scan
  that matches modules to boundaries compares with file extensions stripped, so `src/App.css` matched
  `src/App.tsx` and went out as part of that boundary's update. An extension-blind match now requires
  the candidate to be a file Zintl extracts from at all. This confirms and closes a hypothesis open
  since proposal 027 §2.4.

  And React now declares, through the new `reactRuntimeFacet`, that re-running its entry is not safe —
  `createRoot()` on a container it already owns mounts a second root over the first rather than
  replacing it. Svelte has declared the same thing since the field existed; React could not until
  framework detection stopped guessing React for projects that never mention it.

  Measured on `react-basic` across sixty edits: six double mounts before, one after. No cost on Rspack,
  verified against a real `rsbuild dev` — hot updates there are unchanged.

- 391f5ef: Rsbuild is a supported target.

  `zintljs/rsbuild` now carries a promise rather than a disclaimer: single-page applications, in
  production builds and in `rsbuild dev`, with React and vanilla JavaScript — chunk-aligned catalogs,
  ghost mode, localized assets, per-locale `<html lang>`/`dir`, and hot updates. Vue and Svelte are
  untested on this host rather than unsupported. SSR and per-locale HTML fan-out (`multiplex`) are
  Vite-only, and combining `multiplex` with Rsbuild fails your build with a clear error rather than
  doing nothing quietly.

  Two fixes made the difference, and both were latent rather than new.

  The hot-update hook Zintl registers on Rspack **was never actually being called**. unplugin gates its
  `rspack` escape hatch on `meta.framework === "rspack"`, and its Rsbuild target sets `"rsbuild"`, so the
  tap was dead code and Rsbuild had been hot-updating through the ordinary transform path all along. It
  is now registered from the plugin's own Rsbuild block.

  And the catalog flush was fire-and-forget — correct on Vite, where the browser's update comes from the
  compiler's memory, and wrong on Rspack, where the generated modules declare the catalog files as
  dependencies and Rspack builds them by reading those files. A compilation could therefore be built from
  a catalog that had not been written yet. The flush is now awaited once per watch cycle, which made the
  dev loop measurably _faster_: the late write had been forcing a second compilation per edit.

- Updated dependencies [8d8f942]
  - @zintljs/extractor@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- 7779a8b: Gave the HTML projection a host-neutral path, so `<html lang>`/`dir`, `<title>` and `<meta description>` follow the locale on Rsbuild as they do on Vite.

  `compiler.transformHtml()` was always host-neutral; what was not is the only thing that ever called it — Vite's `transformIndexHtml`, which lives in the plugin's `vite` block and which unplugin drops on every other target. Rsbuild's `api.modifyHTML` has the same shape, so this is wiring rather than a second implementation, routed from the plugin's `rsbuild` block. Deliberately **not** a `BundlerFacet` hook: `ContentFacet.transformHtml` already exists and _is_ the projection, so a bundler hook of the same name beside it would reproduce a naming collision this codebase has been bitten by before — and registering `modifyHTML` is plugin work that a facet, being data and string-returning functions, cannot do.

  **Two things had to be solved that a straight wiring would not have caught.**

  _Identity._ Rsbuild hands the hook an output filename (`index.html`, relative to `dist`) where Vite hands an absolute source path. The projection re-reads the source on a cache miss and computes sink offsets against it, so passing the output name through produces a blank page. It is now inverted through `htmlPaths` and `html.template` back to the source id — and when any step yields nothing, which happens for real when Rsbuild uses its built-in template, it warns and declines rather than silently doing nothing.

  _The boundary link._ Zintl learns which scripts a document loads by reading `<script src>` from markup, and turns them into the document's dependencies — which is how a page reaches a trust anchor and becomes a boundary at all. An Rsbuild template names no scripts: the entry is injected at build time from `source.entry`, so the association lives in the build config. With nothing to read, no HTML document reached a boundary on this host, no catalog was ever scaffolded for one, and the direction map came out empty.

  `CompilerOptions.htmlEntries` is the new declaration — keyed by html id, valued with source ids, unioned with whatever the markup says and empty on every host whose templates name their own scripts. It updates both `htmlProjection.scripts` and `dependencies`, because the extractor derives the second from the first _during_ extraction and afterwards they are two separate facts.

  **Also generalised**: the `locale-switch` contract asserted a request URL containing `virtual:zintl/content/<locale>/`, which is Vite's virtual-module spelling — an Rspack build emits catalogs as ordinary hashed async chunks. The question the contract asks is host-neutral; only the spelling is not, so an optional `LocaleSwitchAdapter.isCatalogRequest` holds the per-project answer and defaults to the Vite form.

- 654569d: Made `<html dir>` follow the active locale on any host, and fixed two defects that stopped it following reliably on Vite.

  Direction used to reach the document only through the HTML projection, which Zintl injects via `transformIndexHtml` — a Vite hook that unplugin drops everywhere else. The runtime had no direction data of its own and deliberately set only `lang`.

  It now has the data. `ContentFacet.rtlLocales` is a new hook, unioned by `ZintlCompiler.getRtlLocales()` and substituted into the generated runtime as a literal array, so the store can set `dir` wherever it already sets `lang`. Core learns nothing about direction or about RTL languages: it merges string arrays that facets return. The HTML facet answers by reading the `dir` field already written into every HTML catalog — so this is one derivation moved to where two consumers can share it, not a new source of truth, and there is no list of RTL languages anywhere in the runtime.

  **Two defects fixed on the supported path**, which together explain why adding an HTML catalog to a page could stop `lang` updating:

  - The projection's `apply()` returned early when `lang` already matched the target locale — but it owns `dir` as well, so anything that set `lang` first permanently locked `dir` out with no way to correct it. Every statement in that function is an idempotent assignment, so the guard bought nothing.
  - The store's own attribute handling was an `else` branch behind `window.__zintlApplyHtml`. The projection installs that function unconditionally but writes `dir` only when the project has an RTL locale, so on every other project it took ownership of the document and then declined to finish the job, silently suppressing the fallback. The two now run in sequence: the store owns `lang` and `dir`, the projection owns the document-specific title, description and body deltas.

  `dir` is written only when the project actually has direction data. Empty means "this project never spoke about direction", and asserting `"ltr"` there would start writing an attribute onto documents that never had one.

  **Removed: the dead `sourceLocale` field on `I18nStore`.** It was written by a build-time substitution and never read — the only occurrence in the whole runtime was its own declaration — and it shipped in every production bundle. Its substitution was also the fragile kind: a regex matching a TypeScript class-field default, one `readonly` keyword or formatter change away from silently matching nothing. `getRuntimeCode` drops its `sourceLocale` parameter and gains `rtlLocales`, which uses the same word-boundary sentinel mechanism as `__ZINTL_DEV__`.

- 0926c2e: Routed virtual-module **recognition** through the bundler facet, closing the half of that seam that never existed.

  `BundlerFacet.resolveVirtualPath` existed to construct virtual ids. Nothing existed to recognise them: core tested `id.startsWith("\0")` — Rollup's convention, hardcoded into a bundler-agnostic layer — at seven sites deciding whether a module was Zintl's own, and therefore whether to normalize it, give it a catalog, or let it become a boundary.

  On Rspack that test is false for virtual modules past the `transform` boundary, because unplugin materialises them as real files under `node_modules/.virtual/`. Nothing broke, because an adjacent `id.includes("node_modules")` test happened to be true — correct behaviour resting on another project's choice of directory name, which would have failed silently by extracting strings from Zintl's own generated catalogs the day that directory moved.

  `BundlerFacet.isVirtualId` is the counterpart. It uses substring rather than prefix semantics, because boundary ids embed the module id they were minted from; Rspack's implementation recognises both spellings a virtual module has on that host. `IOManager` holds and exposes it, since every other manager already holds an `IOManager` and none hold the system view. With no bundler facet the default stays the `\0` test, so nothing changes for the compiler's own unit tests.

  Six of the seven sites moved. The seventh strips a `\0` prefix so a user's SSR entry pattern can match and already tries the unstripped id too — it normalizes rather than asking about ownership, so it stays a byte test with a comment saying why.

  **Also fixes a blind spot in the guardrail meant to catch exactly this.** The facet-composition golden files report single-provider hooks from two hand-maintained arrays, and `hmrSelfAcceptCode` had been missing from both since it was added — so a facet-surface change was invisible to the artifact whose purpose is making facet-surface changes visible. Both hooks are listed now, with a note at the arrays.

  Adds `tests/fixtures/multiplex-assets.ts`, a multiplexed project with `virtualAssets` and a localized binary asset. It covers `emitFile` and `import.meta.ROLLUP_FILE_URL_*` under multiplex, which had no coverage at all.

### Patch Changes

- @zintljs/extractor@0.1.0-alpha.14

## 0.1.0-alpha.13

### Minor Changes

- 4df78f0: Facets now decide for themselves when they apply, instead of being selected by a table in the plugin. This is the self-activation inversion proposal 026 was sequenced to inform, and it uses that spike's leak ledger as its input.

  `autoFacets` no longer chooses. Every built-in facet is offered as a candidate and each answers for itself: the framework switch, `if (ssr && !isNext)` and `if (!isNext)` are gone, and the decisions they encoded are declarations on the facets that own them. Adding a framework now means shipping a facet that knows its own condition rather than editing core.

  **A facet declares its condition as data**, not as a predicate:

  ```ts
  { name: "react-codegen", when: { framework: "react" } }
  ```

  `when` supports `framework`, `bundler`, `dependency`, `ssr` and `dev`; all present fields must hold, and an omitted `when` means unconditional with no check performed. An optional `activate(ctx)` escape hatch covers what a descriptor cannot express. The reason for preferring data is the trace: a predicate can only report _that_ it said no, where a descriptor reports `when.framework=vue ✗ (detected: react, nextjs)`.

  **Activation is not a boolean.** `provides` / `supersedes` / `conflicts` let one facet replace another — Next.js supersedes the generic SSR wrapper and client-SPA facets, targeting a provided capability rather than a hardcoded name. That was previously an `if (!isNext)` whose reason lived in a comment. `conflicts` is the hard-error case for pairs with no sensible winner.

  **Every decision is explained.** Activation emits a trace covering active and inactive facets alike, and it is committed to the per-example composition golden files, so "why is React support off?" is answerable from a text file.

  **Adds an experimental `rspackFacet()`**, activated by `when: { bundler: "rspack" }`. It is as much about what it prevents: with no bundler facet active, the compiler falls back to a snippet that emits `import.meta.hot` — Vite's API — into any host, and five Rspack dev-transform snapshots carried it. Its `hmrInjectionCode` deliberately emits the HMR token and **no acceptance call**, because Rspack uses `module.hot` and ZDB §7a forbids shipping hot updates on a host whose ordering guarantees have not been established. Returning a function at all is the point: it takes core off the wrong fallback.

  **Routes generated modules through the facet seam.** The compiler hardcoded `import.meta.hot` when emitting catalog and manager modules and consulted no facet, so every host received Vite's HMR API for Zintl's own generated code. A new `BundlerFacet.hmrSelfAcceptCode(callbackBody?)` covers it — distinct from `hmrInjectionCode`, which decorates source files and must reason about whether re-executing an entry is safe; a generated module is always safe to replace but sometimes needs a callback body, which the source-file hook cannot express. With no bundler facet supplying it, nothing is emitted.

  **Fixes `import.meta.hot` reaching production bundles.** The `?raw` asset proxy emitted an unguarded `import.meta.hot.accept()`, where its sibling branch was dev-guarded. This was invisible on Vite, which substitutes `import.meta.hot` with `undefined` in production so the branch folds — a host guarantee Zintl was silently relying on. Rspack does not substitute, so it shipped. Now dev-guarded; no change to Vite output.

  **Bundler facets are now host-conditional.** `viteFacet` declares `when: { bundler: "vite" }` rather than being appended to every project. This fixes a real leak: Rspack builds were being handed `import(/* @vite-ignore */ …)`, a Vite annotation in output no Vite ever reads. Bundler facets remain unconditional _candidates_ — opting out of the built-in set should not silently strip host integration — but being a candidate is no longer the same as being active.

  **Option surface — breaking.** `facets: ["auto", …]` becomes `facets: ["builtins", …]`, and `"auto"` is **removed rather than aliased**: it is now a type error. The sentinel was misnamed — it reads as "be automatic", but automatic is no longer optional; what it selects is which _set_ of facets is on the table. Zintl is pre-1.0 with no users to migrate, and a silent second spelling is a migration nobody ever finishes.

  New `excludeFacet(name)` drops a single builtin, which previously required listing every facet by hand and keeping that list in sync.

  Composition is unchanged for every existing example on Vite.

- 3dfd12b: Moved compiler construction and multiplex propagation off the bundler's plugin context, so both are answerable without a Rollup-shaped host. This is the first phase of proposal 026, which uses a second build tool as a falsification harness for the claim that the compiler is bundler-agnostic.

  - **Compiler construction is no longer a Vite-only hook.** `detect → assemble → resolve → construct` moved into a new `host.ts` behind an idempotent `ensureCompiler(ctx, host)`, keyed on a small `BundlerHostView` (`root`, `isDev`, `isSsr`, `pluginNames`, `logLevel`). `configResolved` now only translates Vite's `ResolvedConfig` into that view; `buildStart`, `resolveId`, `load` and `transform` call it defensively. Previously the compiler was assigned in `configResolved` alone — a hook unplugin drops entirely on every non-Vite target, so the plugin would load and then fail on `undefined` at the first resolution.

  - **Multiplex propagation asks the graph instead of walking it.** The 58-line translation-neutrality closure inside `resolveId` — which reached into `metadataGraph`, `internalManifest` and `dependencyGraph` one import edge at a time — is replaced by `ZintlCompiler.isTranslationNeutral()`, backed by a new `GraphManager.hasTranslatableContent()`. The knowledge was always the compiler's; the resolver was rediscovering it per edge while consulting the very structure that had the answer.

  - **Deleted the static extension allow-list** that gated multiplex propagation (`js`, `jsx`, `ts`, `tsx`, `md`, `txt`, `vue`, `svelte`). It was app-agnostic — a Vue-only project paid for `.svelte`, and a facet contributing a new extension was silently skipped — and it was answering "might this file contain strings" where the graph can answer "is this module inside translated content". Nothing replaced it.

  Note that `hasTranslatableContent` is deliberately **not** `leadsToBoundary`: the latter asks whether a file reaches a trust anchor (locale ownership), while multiplexing needs to know whether it reaches translatable content (payload). A component holding strings but declaring no anchor answers differently to the two, so reusing the existing method would have silently dropped its translations.

  No behaviour change on Vite.

### Patch Changes

- 6926203: The document now announces the locale the store actually adopted, on every host.

  Zintl publishes a locale change to `<html lang>` by calling `window.__zintlApplyHtml`, which is installed by the HTML projection script — and that script is injected through `transformIndexHtml`, a Vite-only hook. On any other bundler no projection exists, so a page could switch locale, render the new language, and go on announcing the old one to assistive technology and search engines.

  `publishLocale` now sets `document.documentElement.lang` itself when no projection is installed. The store always knows the locale it adopted, so it can say so unaided, and the branch runs only when nothing better is present — the projection keeps full ownership wherever it exists.

  `dir` is deliberately not handled here. Direction is per-locale data the projection reads out of catalogs at build time; giving the runtime its own table would put a list of RTL languages in the compiler core, which is knowledge that belongs to a facet.

- 49f299c: Fixed the translation-neutrality walk skipping dependencies imported without a file extension.

  `GraphManager.hasTranslatableContent` decides whether a module needs a per-locale copy during multiplex propagation. It resolved a relative dependency by path-joining alone, so `./counter` became `src/counter` — a key in no graph — and the walk stopped there, reporting the importer as having nothing to translate. It now resolves through `resolveDependencyFileId`, which tries each known source extension, as every other traversal in that file already did.

  The failure direction is why this matters: "neutral" means _needs no per-locale copy_, so a false positive silently drops a module's translations, where a false negative only costs a redundant copy.

  A second defect surfaced while testing it and is now closed: `resolveDependencyFileId` resolved against the manager's last-built graph state while its caller was handed graphs as arguments, so the two could disagree about which files exist. The graphs are now overridable parameters.

  Resolution deliberately keeps **exact** key lookups. Also matching the manifest's `<file>:<boundary>` prefix during resolution looked correct but cost a `Object.keys` scan per candidate, per extension, per dependency edge, and blew the Structural and Colony HMR budgets by 48% and 23% on an idle machine. It bought nothing: a file with manifest entries is keyed in the metadata and dependency graphs too, and both are exact. Content discovery still prefix-matches, once per node rather than once per candidate.

  No output changes: the predicate short-circuits as soon as the importing module itself has content, so a dependency's resolution only decides the answer for an inert module whose sole translatable content sits behind an extensionless import in a multiplexed project. Adds the first unit coverage this predicate has had.

  - @zintljs/extractor@0.1.0-alpha.13

## 0.1.0-alpha.12

### Minor Changes

- 422bfac: Beta-prep pass on the compiler: dead code removed, `any` usage cut from 252 to 141 occurrences (all internal — the compiler's public surface is now fully typed except one genuinely-dynamic disk-read catalog value).

  **Dead/redundant code removed:**

  - Leftover commented-out debug scaffolding in `ZintlCompiler`.
  - A duplicated HMR self-accept snippet (the no-facet fallback re-implemented, and slightly diverged from, `viteFacet()`'s own logic) — consolidated into one shared helper.
  - A redundant `pipeline/types.ts` barrel that re-exported the exact same thing as `src/types.ts`.
  - ~16 independent copies of the Windows-path-normalization idiom (`.replace(/\\/g, "/")`) and 3 copies of the monorepo-example-detection check, each consolidated into one shared utility.
  - Pruned unused public exports with zero consumers anywhere in the monorepo: `DeliveryBus`, `DeliveryBusOptions`, `DeliveryChannel`, `DeliveryLedgerEntry`, `DeliveryOutcome`, `Envelope`, `TerminalOutcome`, a duplicate `ZintlLogger` re-export, and `similarity`/`sortObjectKeys`/`compareStrings`. Implementations are untouched — only the public re-export is gone, since nothing outside the package's own internals imported them by name.

  **`any` → real types**, working from the root cause outward (`MessageManager`'s untyped graph/manifest fields cascaded `any` through `GraphManager`, `CatalogManager`, `CompilerContext`, and `ZintlCompiler` itself) rather than annotating each call site independently:

  - Fixed `types/graph.ts`'s `DependencyGraph` alias, which had been defined against the wrong upstream type (`@zintljs/extractor`'s `BoundaryDep`, optional `bindings`) when every real consumer needs the compiler's own `ObservedDependency` (required `bindings`) — a latent type-definition bug the `any` had been quietly hiding.
  - `MessageManager`, `GraphManager`, `CatalogManager`, `IOManager`, `CompilerContext`, and `ZintlCompiler` now use the domain vocabulary that already existed (`Manifest`, `DependencyGraph`, `MetadataGraph`, `BoundaryGraph`, `ChunkGraph`, `CompilerContext`, `CatalogFormatContext`, `ZintlLogger`, magic-string's `SourceMap`) instead of `any`.
  - Facet hooks with genuinely per-facet dynamic state (`ContentFacet.setup`/`getStateToSave`/`getManagerInstance`) now return `unknown` rather than `any` — honest about being untyped without inventing a new abstraction.
  - `ZintlCompiler.assets`/`.html` (typed `unknown`, correctly — the compiler core cannot know about specific facets) surfaced ~40 call sites in `zintljs` that were relying on `any`'s silence to treat them as concretely-shaped objects. Exported the two previously-private manager classes (`AssetManager`, `HtmlManager`) as types from `@zintljs/compiler/facets` so those call sites can narrow honestly instead.

  Remaining `any` usage is concentrated in `pipeline/*` internals, `runtime/*` (served as text to the browser, not part of the public `exports` map), `facet/presets/{html,assets}.ts`, and a handful of genuinely-dynamic disk-read catalog/schema values with no existing type to reuse — left as a deliberate follow-up rather than inventing new types under this pass.

### Patch Changes

- @zintljs/extractor@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- 43ebb95: Fix a race in `flush()` that could silently drop the latest edit to a boundary under rapid, overlapping hot updates.

  `runFlush` snapshotted the dirty boundary set into `adopted` before writing catalogs, then unconditionally cleared every adopted id from `dirtyBoundaries` afterward. If a newer edit re-dirtied that exact boundary after its catalog had already been written but before that cleanup ran, the cleanup deleted the fresh dirty flag anyway — the newer content was never flushed, and nothing was left to schedule it for later. Locally each edit's cycle finishes before the next one starts, so the window never opened; under CI's slower scheduling, overlapping flushes were common enough to hit it, which is why `hmr-hammer` only flaked in CI.

  `MessageManager` now tracks a `dirtyRevisions` counter per boundary, bumped by a new `markDirty()` on every dirty mark. `runFlush` snapshots each adopted boundary's revision at adoption time and only clears it if the revision is unchanged — i.e. nothing re-dirtied it while this run was writing.

- 7c69554: Updated external dependencies:

  - @formatjs/icu-messageformat-parser@^3.5.16
  - magic-string@^1.1.0
  - vite-plus@0.2.7

- Updated dependencies [7c69554]
  - @zintljs/extractor@0.1.0-alpha.11

## 0.1.0-alpha.10

### Minor Changes

- 91662bd: Add the delivery bus — a governance discipline for ordered, repeatable work.

  Zintl does the same shape of work in four places: something changes, a procedure runs, and a result is delivered elsewhere. A file changes and a packet is emitted. A catalog arrives and a store applies it. A flush is requested and disk is written. A facet is asked and contributes. Every one of those is repetitive, concurrent, and capable of conflicting with itself — and none of them had a name for **what** was being delivered, **in what order**, or **whether it landed**.

  The measured consequences: a later update losing to an earlier one, a boundary rendering blank permanently with nothing recorded, a flush silently discarding the boundaries a second flush had dirtied, and outputs surviving on disk after the source that produced them was gone.

  This is not a message queue and not a transport. It is five absolute axioms plus the smallest data structure that enforces them, specified in `docs/spec/ZDB.md` and promoted alongside ZRS/ZHMR/ZCD:

  - **D1 Monotonic Supersession** — a receiver discards anything not newer than what it applied. Latest wins _by number_, never by arrival time and never by a debounce window.
  - **D2 No Silent Abandonment** — every envelope reaches `applied`, `superseded` or `failed`. Coalescing is a named outcome, not a disappearance.
  - **D3 Causal Custody** — a stage that coalesces inherits the superseded envelope's subjects, so no subject is left without a custodian.
  - **D4 One Subject, One Owner** — competing contributors resolve by declared rank; a tie is a hard error at construction.
  - **D5 Cost Asymmetry** — identity and sequence ship; the ledger and every reason string are development-only and eliminated at build time.

  `DeliveryBus` is exported from `@zintljs/compiler`, with `mint`/`accept`/`holds` as the ordering machinery and a bounded ring for diagnosis. Recording is off by default, so a caller who forgets gets the cheap bus: the failure mode is "no diagnosis available", never "diagnostic machinery left on". The ring is bounded normatively rather than as an optimisation — `memory-leak` measures retained heap across twenty consecutive hot updates with only a few hundred kilobytes of headroom.

  Two documents were reconciled against the code on the way in. Proposal 024 is marked ABSORBED, with the three things it got wrong called out. **ZRS §9.1 is superseded**: it promised a source-locale fallback and exponential-backoff retry, neither of which was ever implemented, and the first of which is forbidden outright — a missing translation is a build-time error, not a reason to render a different language. The original text is preserved rather than deleted, because knowing which model was intended and rejected is worth more than a silent removal.

- cc88b36: Let frameworks declare whether re-running an entry is safe, and fix the Svelte double-mount.

  Zintl injects `import.meta.hot.accept()` into files that declare a trust anchor — which are the files that mount. Accepting tells the bundler to re-execute the module, and the injected callback only logged, so it claimed the update was handled while the mount ran a second time.

  Whether that matters is a property of the framework. Assigning `innerHTML` replaces. Svelte's `mount()` appends a second copy. `chaos-boundary` reproduces the Svelte case exactly: the page renders twice, 14,665 bytes instead of ~7,300, the locale switcher appearing twice, and the heading selector reading the stale copy.

  Both blanket answers were measured, and each is wrong for the other half:

  - **Always self-accept** double-mounts Svelte on an entry rewrite.
  - **Never self-accept** turns every entry edit into a full page reload, which times out `memory-leak` on `vanilla-spa-basic` — twenty sequential entry edits become twenty reloads. (An earlier attempt used `import.meta.hot.invalidate()`, the same thing by another route: it regressed `hmr-hammer` on every project and took the suite from ~75 s to ~127 s.)

  So the framework decides, through `RuntimeFacet.entryReexecutionSafe`. `svelteRuntimeFacet` declares `false` and joins the compound preset; everything else keeps the self-accept and keeps its hot updates hot. The flag merges **pessimistically** — one facet declaring re-execution unsafe decides it for the project, because a project containing any non-replayable mount has one, and OR-ing these the usual way would let a safe facet vote away a hazard another facet reported. Absent means safe: the conservative direction is the one that keeps hot updates working, and a framework needing the other has to say so.

  **A trap worth knowing before adding any other runtime claim.** React was marked unsafe first — `createRoot()` does throw on a container it already owns, which is what proposal 024 §1.3 recorded. It had to be reverted, because **`FALLBACK_FRAMEWORK` is `"react"`**: a project where no framework is detected is assembled with the React facets, so `vanilla-spa-basic` silently inherited React's runtime claim and began full-reloading on every entry edit. `syntax-recovery` started timing out and the dev-transform snapshot showed vanilla emitting `invalidate()`. Any claim attached to the React facet reaches every framework-less project by default; a runtime constraint has to be worth that reach before it is added there.

  React's `createRoot` case is therefore still latent. It is not reproduced anywhere in the suite, and fixing it speculatively cost more than it bought — the honest state is that the mechanism is now understood and the fix is one facet field away once a reproduction exists.

  **`chaos-boundary` is fully live — 4 of 4**, no longer `pendingFor` anything; it was skipped entirely three changes ago. Only the Svelte snapshots moved, which is the scope of the change stated as a diff.

- 2af5252: Make every facet fan-out declare how it composes, and draw the bundler-support line.

  Axiom D4 was already enforced for four hooks — highest priority wins, a tie is a hard error at construction. Eight other fan-outs over the same facet set resolved silently and inconsistently. Two of them were outright defects:

  - **`getTranslations` was `Object.assign` in a loop.** When two content facets produced the same key with different text, the last one in iteration order silently won and the other's content simply never appeared. That is not a merge, it is a coin toss decided by registration order. It is now a declared `union`, and a genuine collision — same key, different value — is a hard error naming both facets. Two facets _agreeing_ about a string is not a conflict and stays legal.
  - **`transformHtml` returned inside its loop.** The first facet implementing it won and every later one was unreachable code: a facet could be registered, be asked for nothing, and have no way to find out. It is now a `chain` — each facet sees the previous one's output — which is also the semantics HTML transformation actually wants, since projections, preloads and bootstrap injection compose rather than compete.

  Two more that were undocumented policy rather than bugs, now stated:

  - **`wrapDefault`** kept the first contributor silently. Facets are already sorted by descending priority, so the outcome was right; what was missing was the tie being an error. Two facets disagreeing about how to wrap the default export at the same rank now fails at construction, like its four siblings.
  - **Facet lifecycle steps** (`setup`, `flush`) ran in a bare sequential `await` loop, so a facet that threw took the loop with it and every facet after it in registration order silently never ran. Each step now settles a `build/pipeline` outcome naming the facet, and a failure stops the step rather than the remaining facets — the composition is `union`, so the facets are independent and one failing does not make the others wrong.

  `ZDB` §7.1 now tabulates the declared composition of **every** fan-out, so the next contributor does not have to infer it from a loop body.

  ## The bundler-support line

  `ZDB` §7a states what a build tool must provide, in two tiers, because "support another bundler" has been an open-ended question and the answer is not uniform.

  **Tier 1 — build.** Virtual modules, a `transform` hook with stable per-file ids, build lifecycle hooks, plugin ordering, and optionally HTML transformation. Every bundler unplugin targets can meet this, and it is where support for a new tool should start.

  **Tier 2 — development.** Everything above plus a hot-update hook, module-graph invalidation, a per-module update token that reaches the client, and a server→client channel. Two of its rows are load-bearing and are why this tier is narrower:

  - **A monotonic, non-repeating timestamp per hot-update event.** Without it there is no ordering authority and D1 cannot be enforced.
  - **`read()` for the content of _that_ event.** Reading the file independently is precisely how a later write becomes a no-op (§4.1a).

  A bundler offering a hot-update hook without those can deliver updates but cannot **order** them — which is the defect this entire specification exists to remove, so shipping dev support on such a tool would be shipping the bug back. And do not emulate the missing sequence with a counter of your own: a second clock that can disagree with the bundler's is worse than no clock at all.

  **On verification.** The unit gate is green at 717 tests, and the facet-heavy contracts (`assets`, `initial-render`) pass in isolation with no facet conflict raised. Full-suite contract runs on the machine used here are unreliable — see the note in `artifact-lifetime`; the pre-change baseline fails worse than the current code under the same load. Re-run `vpr ready:examples` on a quiet machine before drawing contract-level conclusions.

- 553cdae: Tell the compiler when a file is deleted.

  Nothing ever did. The bundler handles `unlink` separately from `change` — it removes the module from its own graph and reloads, but never calls `handleHotUpdate` or `hotUpdate` — and the plugin registered no watcher of its own. A deleted boundary therefore stayed in the compiler's graph and manifest for the life of the process.

  That is worse than stale state, because dev servers are pooled per worker: the orphan outlived the thing that created it. In the contract suite it leaked into every later contract's graph snapshot, and through the compiler's persisted manifest it reached the **committed examples** — twelve generated JSON files describing source that no longer existed, from a single test run.

  `ZintlCompiler.removeFile()` forgets the file and everything it owned: manifest entries, boundary ownership, metadata and dependency graph entries, catalog caches, boundary revisions, and the graph nodes themselves. `MessageManager.trackBoundaryChange` already knew how to drop the boundaries a file no longer owns — passing it an empty set is exactly "this file owns nothing now", and the gap was only ever that a deletion never reached it. The removed boundaries are marked dirty as well: pruning finds orphans by comparing the output directory against the live graph, but the flush still has to be told something changed, or a deletion made during an idle moment sits unflushed until an unrelated edit wakes it.

  The watcher is registered in `configureServer`, deliberately **before** the `appType === "custom"` early return. That exit skips the multiplex middleware, which SSR apps do not want — but they do want their deletions noticed, and registering after it would have left every SSR project with the exact bug this listener exists to fix.

  **`chaos-boundary` is live again on three of four projects.** It had been skipped entirely; it now runs and passes on `react-basic`, `vue-basic` and `vanilla-spa-basic`, with the graph snapshots and the committed examples verified clean afterwards — which is the check that matters, since the leak's damage was always downstream of the contract that caused it.

  Contracts can now declare `pendingFor` — a per-project gap, keyed by manifest name. A blocker is rarely uniform: skipping all four projects to describe a failure on one throws away the three that work, which is the same loss as marking the whole thing green would be, in the other direction. `chaos-boundary` uses it for `svelte-basic`, whose remaining failure is proposal 024 §1.3 — the entry self-accepts, re-executes and mounts twice — and needs a framework-side `hot.dispose()`, not anything here.

  **Unrelated, and pre-existing:** `performance-size` failed once in seven runs during this work, at 10,972 bytes against a 10,240 budget. It is not a regression — it passes in isolation and in six of seven full runs — but it is not measuring what its name suggests either. It captures _dev-mode_ response bodies inside a timing window (its own comment sizes the budget for "Vite dev-mode wrapper overhead"), so which responses land in the window varies. Like `performance-hmr`, it is a smoke check shaped like a budget, and it will get less meaningful as more examples are added rather than more.

- 91662bd: Take custody of hot updates from the watcher to the applied catalog.

  The bundler's watcher is unqueued — `watcher.on("change", (file) => { onFileChange(file).catch(…) })` — so two rapid changes to one file spawn two concurrent update runs. Zintl cannot fix that upstream, but everything below was Zintl choosing not to defend against it.

  - **Invalidation now runs once per event, not once per environment.** The hot-update hook is invoked once for the client environment and again for every other one, so a single filesystem change reached the compiler two or more times: the boundary revision was bumped twice and two re-extractions of the same file raced each other. Later passes now join the first pass's promise instead of starting a competing run. Each environment still invalidates its own module graph, which is the part that genuinely is per-environment.
  - **The compiler stopped re-reading the changed file.** `invalidateFile` read from disk itself rather than using the content the hook was handed. Under two concurrent runs both read whatever was on disk _at that moment_, so the earlier invocation observed the later content and the later one then found nothing to emit — a concrete mechanism for proposal 024 §1.1a's "the write never became a packet".
  - **Catalogs carry the generation that produced them.** Every generated content module is stamped with a monotonic `catalogGeneration`, and the runtime discards a catalog that arrives after a newer one has been applied. A burst of rapid edits now settles on the last one _by construction_ — an out-of-order arrival cannot win a race it never entered.
  - **The summed HMR token is gone.** `boundaryRevisions` was summed across a file's boundaries, which is not injective (two boundaries at revision 1 is indistinguishable from one at revision 2), and emitted into a source comment nothing ever read. The generation replaces it and has an actual receiver.
  - **The second invalidation path is stamped.** The `transform` hook invalidates virtual modules too and set no `lastHMRTimestamp` at all, so modules invalidated from there carried no ordering token whatsoever.
  - **The self-write guard names what it swallows.** It still suppresses edits inside a 500 ms window — narrowing that needs a content-identity check surviving the formatter rewriting the file after the write — but a dropped edit is now recorded rather than silently discarded.

  **A correction worth reading before extending this.** The first attempt applied D1 to invalidation directly: an event older than one already processed was discarded. That regressed `hmr-hammer` from 0 failures in 17 runs to 2 in 17, reproducing exactly the signature proposal 024 §1.1a records — one fewer packet than there were writes, and the DOM stuck on the last state that reached the wire.

  D1 governs deliveries that **replace** state; a newer catalog makes an older one irrelevant, so discarding the older loses nothing. Invalidation does not replace, it **accumulates** — it marks boundaries dirty, clears caches and re-extracts, and each event may describe a different state of the file. Dropping one throws away work no later event redoes, and the update it would have produced is never emitted. The test for which kind you have: _if the newest envelope alone would leave the system correct, it replaces and D1 applies; if earlier envelopes contributed something the newest does not carry, it accumulates and D1 does not._

  This is now `ZDB §4.1a` and a first-class API rather than a convention: `DeliveryBus.observe()` reports position and advances the high-water mark without settling, because `accept()` labels a rejected envelope `superseded`, which on an accumulating channel is a plain lie about what happened — and a ledger that misreports is worse than no ledger. Measured after the correction: 0 failures in 27 runs, against a 0-in-17 baseline.

  `CompilerContext` gains a `bus` field, so a facet performing ordered or repeatable work can take custody of it rather than relying on the surrounding sequential `await` to notice a failure.

- 9c10e78: Make the compiler's own stages recoverable, ordered and accountable.

  The flush and the graph rebuild were the compiler's versions of the two defects the runtime had: one collapsed concurrent callers onto work that did not include their changes, the other let whichever rebuild _finished_ last decide the world.

  - **A failing flush no longer poisons every later one.** `flushPromise = null` was the last statement _inside_ the async body, so a single throw left a rejected promise cached and every subsequent flush returned that same rejection for the life of the process. `verifyIntegrity` throws by design on a missing translation, and the hot-update hook swallows the result with `.catch` — so a compiler could stop flushing entirely and nothing would say so. Now cleared in a `finally`.
  - **A flush no longer destroys work it never adopted.** The run snapshotted `dirtyBoundaries` near its start and cleared the whole set near its end, so a boundary dirtied _during_ the run was not deferred — it was discarded, and no later flush knew it existed. Only the boundaries a run actually adopted are cleared.
  - **A caller arriving mid-flush gets a follow-on**, not the in-flight promise. Awaiting someone else's run resolves to "their work finished", which is not what the caller asked (Axiom D3).
  - **A graph rebuild that was overtaken discards its result.** `graphDirty` is cleared _before_ the async body runs, so a transform during a rebuild starts a second concurrent one; both then assigned `boundaryGraph`/`chunkGraph` and the winner was whichever finished last. Rebuilds genuinely replace state, so D1 applies here — unlike invalidation, which accumulates (ZDB §4.1a).
  - **The hive is written by the flush.** It had its own debounce on the same 300 ms constant, with nothing sequencing the two, so a burst of edits could write the hive from a state the flush had not reconciled. The timer survives only as a fallback for when no flush follows.
  - **Pipeline diagnostics are no longer written to a field nobody reads.** `resolve` and `apply` have always produced a structured `Diagnostic[]` — overlapping rewrites dropped, duplicates merged — and every one was discarded. A dropped rewrite is a source mutation that did not happen. Warnings, errors and validation failures now reach the ledger; `info` is skipped, because a ledger reporting routine work is one nobody reads.

  **Two regressions found by measurement, not review**, both worth knowing before touching this again.

  The first: an unconditional follow-on flush **livelocks**. The flush body reaches back into the compiler — `syncGraphs` asks content facets for translations, which can transform, and `transform` schedules a flush — so each run dirtied just enough to justify the next. It presented as a dev server that stopped pushing updates and a contract timing out at 45 s, a long way from where it started. The follow-on now runs only when something is genuinely still unflushed.

  The second was in the runtime, and only a full-suite run under load exposed it: `__zintlApplyHtml` and the `localStorage` write happened **before** a locale switch claimed the active-locale slot, so a switch that was then superseded rewrote `documentElement.lang` anyway. The page rendered Arabic while announcing itself as English, and `locale-switch` and `locale-storm` both caught it. Claim and publish now happen in one synchronous block: claims are ordered, so whichever switch claims last also publishes last, and the document ends up describing the locale the store actually adopted.

  `hmr-hammer` remains intermittently red under full four-worker load with the signature proposal 024 §1.1a records — fewer packets than there were writes. That is the pre-existing failure the proposal measured at roughly one full-suite run in five, and it is upstream of anything here: the loss is a packet the watcher never produced, not one delivered out of order.

- 91662bd: Order and account for every catalog and locale change in the runtime.

  The store had no notion of which delivery was newer, so a slow one could overwrite a fast one that started later, and a failed one left no trace. Seven defects, all confirmed in source:

  - **Locale cross-filing.** `loadLazyBoundary` and `registerLoader` called the loader with `this.locale` captured at call time, then filed the result under `this.locale` read _after_ the await. A switch landing mid-load stored one language's strings under another language's key. Both now capture once.
  - **Overlapping locale switches.** Two switches each wrote `this.locale` and each notified, so the final state was decided by whichever set of promises happened to settle last. A switch now claims the store's active-locale slot and, after awaiting, checks it still holds it; an overtaken switch settles `superseded` and stays quiet.
  - **The in-flight drop.** A concurrent request for a boundary already loading hit `if (pendingBoundaries.has(id)) return;` and was handed `undefined` — no promise to await, nothing to supersede, and a caller that believed it had started a load. It now joins the in-flight promise.
  - **Three abandonment paths** — empty result, rejection, synchronous throw — each now settles `failed` with a reason. Deliberately still no retry: retry cannot fix ordering, and converts a loud failure into a slow one.
  - **`pendingPromises` leaked in the browser.** The server drains it to gate stream injection; nothing drained it client-side, so a long-lived page retained every lazy load it ever performed.
  - **Subscriber isolation.** `listeners.forEach((l) => l())` meant one throwing subscriber silently cancelled every subscriber registered after it.
  - **`_t`'s browser branch** deferred the load into a microtask and never re-read, so the first render tick after a hot update registered a new loader always returned `""` even when the strings were available on that very tick. It now mirrors the server branch, which already had the re-read.

  **The settle beacon changes meaning.** `globalThis.__zintl_version` used to advance only when a catalog value actually differed, so an idempotent redelivery advanced nothing — making "applied, unchanged" indistinguishable from "lost", which is precisely what an observer must be able to tell apart. It is now derived from delivery outcomes and counts every terminal outcome, including `superseded`: an observer asks "has the store finished with my change?", and `superseded` is a finished answer. Subscribers are a separate concern and still only run on real change. Anything asserting a specific beacon delta will need updating; anything asking "did something settle?" is unaffected.

  A development-only ledger is published at `globalThis.__zintl_ledger` as a bounded ring.

  Production carries only what makes an ordering decision: `mint`, `accept` and `holds` ship; `settle` compiles to an empty shell. Guarding `settle`'s _body_ turned out to be insufficient — the argument expressions still evaluated, so `"overtaken by seq " + prior` was doing string concatenation in production bundles. Guards now enclose the calls. The failure reporter also became a free function rather than a method, because as a method it compiled to a closure allocated per load returning `(reason, err) => {}`. Verified: zero delivery identifiers across every example's client bundle.

  Two specification corrections that only surfaced in implementation, now in `docs/spec/ZDB.md`: `runtime/catalog` is keyed by `<locale>/<boundaryId>`, not boundary alone, because a boundary's Arabic and French catalogs are separate deliveries; and `runtime/locale` has exactly one subject rather than one per locale, because the contested resource is the active-locale slot. The rule both illustrate: **the subject is the resource being contested, not the value being delivered.**

### Patch Changes

- 69fed7f: Give written artifacts an owner, and stop the test scratch trees growing forever.

  The author's account of this class was "a very little ones just shock the system and live for ever in a disk category". Two of those were measurable in the repository itself.

  **The test scratch trees.** `createZintlContext` returned a `cleanup` that was an empty function. Every test dutifully awaited it in `afterEach` or `afterAll`, and every run left its directory behind: **5,308 directories, 53 MB**, invisible because `.tmp` is gitignored. A second helper, `createTestDir`, had no cleanup at all and no caller that removed anything, adding another ~20 MB of `html-deep-*` and friends to a different `.tmp` at the repository root. Two independent scratch trees, both unbounded, both hidden.

  A cleanup contract that callers honour and the implementation ignores is worse than no contract — it makes the leak invisible to exactly the people looking for it. `cleanup` now removes the directory, the two helpers share one temp policy, and the base is cleared once per worker on first use so a context whose `cleanup` is never called costs one run rather than every run. Per-worker matters: Vitest runs workers as separate processes against one working directory, so a shared base would let whichever worker started last delete directories the others were still using. Measured across three consecutive full runs afterwards: **40–96 KB, stable.**

  **Pruning consulted a branch that could not run, and would have thrown if it had.** `pruneOrphanedBoundaries` declared a `contentFacets` parameter that its only call site never passed, so the content-boundary protection was unreachable; and the call inside it passed a boundary's metadata where the facet contract declares a `CompilerContext`, so the moment it became reachable it threw `context.getMetadataGraph is not a function`. Two faults hiding each other — dead code does not get to be correct by never running. The facets now come from the field the manager already holds rather than an argument a caller has to remember, and the context is built in the shape the hooks actually read.

  **A prune could be skipped because a counter matched.** The skip key hashed the _size_ of the active content-path set, so swapping one content path for another left it identical and the prune that should have reclaimed the old output never ran. It now hashes the contents.

  **Every write and removal has an outcome.** `safeWriteFile` settles on all three paths — written, skipped as already identical, failed — and `rm` settles too, because an output that vanished and one that was never written look identical on disk. Only the ledger separates them, which is "artifacts outliving their source" in reverse.

  **Pruning in development is named, not enabled.** It is disabled outright for real dev sessions, so a deleted source's catalogs survive the whole session. Turning it on is not a flag flip: `chaos-boundary`'s rename and delete body is commented out behind a "Fix Pruning Left-Over Catalogs on File Deletion" note, which says the reachability question this depends on is still open. Trading an accumulating leak for the chance of deleting a live catalog is much worse, so the staleness gets a name in the ledger instead.

  Also removes two stray artifacts that had been tracked in git since July: an empty `pipeline/task.md` and `pipeline/intent.ts.clean_anchor.txt`.

  **A Phase 3 revision.** The follow-on flush is gone. Its stronger reading of D3 — the caller's own promise resolving when its work lands — cost a full extra flush per hot update, because `runFlush` transforms and `transform` schedules a flush, so every run left a timer that fired afterwards. That timer is now cancelled when nothing is left to flush. What made the original defect a defect was the _destructive clear_, and that fix stays: a mid-flush caller's boundaries survive for the next run rather than being wiped. ZDB §4.3 now says explicitly that deferral satisfies D3 and only destruction violates it.

  **On the measurements.** Contract failures during this work were chased for a while as regressions. They were not: re-running the pre-change baseline under the same conditions produced _more_ failures (8 across five contracts) than the new code (1), because the machine had been running suites back-to-back for hours. This is exactly the trap proposal 024 §7 records — "measure on a quiet machine … that data was worthless and nearly sent the investigation after a phantom". The follow-on removal above rests on the livelock, which is reproducible in a unit test, and on the mechanical fact of the doubled pass; not on the contaminated parallel data. Re-run the gates on a quiet machine before trusting any contract-level conclusion here.

- d3a1100: Make the test harness wait on identity, and put the ledger in every failure.

  **Strict delivery now passes the whole contract suite** — 72/72 under `ZINTL_STRICT_SETTLE=1`, with per-contract exemptions declared rather than assumed. That is proposal 024's third acceptance criterion, which previously had no mechanism to hang on at all: strictness was read straight from `process.env` inside the lab, with no way for a contract to say "I deliberately break the app".

  Exemptions are a **string, not a boolean** — an exemption without a reason is indistinguishable from one nobody revisited. Three are declared: `syntax-recovery` (a compile error _should_ stall the runtime), `chaos-catalog` (deleted and corrupted catalogs _should_ fail to apply) and `chaos-boundary` (deleted and renamed sources). They live on the contract, next to `requires`, so an exemption travels with the thing it exempts.

  **Waits are scaled to what the contract said to expect.** A contract declaring itself exempt has already announced that its writes will not settle — it introduces a syntax error, or deletes a catalog. Waiting the full budget for a stall the contract announced in advance is pure cost: a four-second packet race no packet will end, then a ten-second settle wait for a beacon that will never advance, on every such mutation. Those budgets are now short for exempt labs. Nothing is weakened, because the real gate is the assertion — `textEventually` polls for fifteen seconds either way.

  That, plus deleting the dead two-second teardown sleep, takes the suite from **~119 s to ~72 s**, and collapses its variance: three consecutive runs at 71.4 / 72.5 / 72.1 s, against a previous spread of 78–88 s. The variance mattered as much as the mean — most of it was exempt contracts sitting in timeout loops whose duration depended on machine load.

  An identity-based wait (read the compiler's generation, wait for the page ledger to reach it) was built and then **removed**. It measured no faster than the packet race, it cost a fixed probe on every lab, and it caused a `memory-leak` timeout that needed two follow-up patches. The ledger is where the value actually landed — as diagnosis, below — and a contract that genuinely needs identity-based waiting can read it in about ten lines.

  **Every contract failure now carries the delivery ledger.** Packet counts and a beacon say _how much_ happened; they cannot say which boundary, in what order, or whether anything was superseded or failed — which is the difference between "the update never arrived" and "it arrived and was discarded as older than one already applied". Those have different fixes and used to cost a fresh investigation each. Both ledgers are attached: the page's, and the compiler's, which survives the page and is reachable in project mode where there is no browser at all.

  Three long-standing harness defects fixed in passing:

  - `lab.fs.rename()` fired **neither** mutation hook, so a contract that renamed a file and then asserted on the DOM was racing the dev server with no synchronisation whatsoever.
  - Lab teardown called `ws.waitFor("update", { timeout: 2000 })` immediately after `ws.teardown()` had already restored the original `send`. No listener could ever fire, so it was a guaranteed two-second sleep on every browser lab teardown, dressed as a wait.
  - The five surviving `waitFor({ state: "visible" })`-then-`textContent()` sites are migrated to `textEventually`. That pair looks like it waits but resolves immediately when the element is already visible showing the _previous_ value, so the read races the update — the shape every traced flake came from.

- 2830f35: Make boundary ownership deterministic — the same source compiled to two different graphs.

  `computeTranslationChunks` assigns ownership by walking each chunk root's static tree and keeping whichever root reached a boundary first. The root set came back from `getChunkRoots` in graph-insertion order, so for any boundary reachable from two roots, **iteration order decided the owner**.

  Insertion order is not stable across runs. A compiler starting cold discovers in filesystem-traversal order; one reading a saved manifest gets the manifest's key order, and manifests are written sorted. So whether a previous build had run changed the graph.

  It is directly observable in `react-basic`, whose `main.tsx` holds two nested anchors — `bootstrap` and an anonymous arrow function — both of which statically reach `App`. Warm, `src/App.tsx:App` was owned by `src/main.tsx:bootstrap`. Cold, by `src/main.tsx:f_547`. Both compiles were internally consistent; they simply disagreed, and the disagreement propagated into chunk assignment and four committed graph snapshots.

  Roots are now sorted lexicographically before ownership is assigned. Cold and warm produce identical graphs, and the committed snapshots — recorded warm — remain correct, because `"bootstrap"` sorts before `"f_547"`.

  **ZRS Axiom 4 already required this.** Its rule was stated for circular dependencies while its rationale — "deterministic, reproducible builds regardless of file system enumeration order" — was general, and the general case was where it was being violated. The axiom now says what the code does: wherever ownership is decided by which candidate is reached first, the candidates are ordered lexicographically, never by discovery order. Any first-wins resolution that is not explicitly ordered is an instance of this bug waiting to be found — which is the same rule ZDB Axiom D4 states for facet fan-outs, arrived at from the other direction.

  Covered by `zrs-s4-ownership-determinism`, which feeds the same two roots in both orders and requires one answer. Both of its cases fail without the sort.

- 90dd704: Stop contract runs writing into the committed examples, and add an SSR isolation contract.

  **The per-worker copy was not actually isolated.** `copiedExampleSource` reproduces `node_modules` as a symlink farm that skipped `.vite`, `.cache` and `.vite-temp` — but not `.zintl`, which holds the compiler's persisted manifest. The copy and the real example therefore shared one, and the consequence escaped the test run entirely: a contract that renamed a file wrote a phantom boundary into four examples' manifests, and the next `build:examples` read it back and generated catalogs for source that did not exist — twelve untracked JSON files in the tracked `examples/` tree, from one contract.

  `.zintl` is now **copied** per worker rather than linked. Omitting it was tried first and is wrong for a reason worth recording: a compiler starting cold resolves boundary ownership differently from one reading a saved manifest — `src/App.tsx:App` moved from `src/main.tsx:bootstrap` to an anonymous `src/main.tsx:f_547`, changing four committed graph snapshots. That difference deserves its own investigation, since ZRS Axiom 4 says ownership is deterministic; it is not the copy helper's job to absorb. Copying gives every worker the same warm starting state with no shared mutable file, which is the property the copy exists to provide. Verified by running the offending contract live and confirming `examples/` stays clean.

  This is the same failure the `.vite` comment two lines above already warned about, missed for the same reason it gives: module resolution keeps working perfectly while the state underneath is shared, so nothing looks wrong until an artifact outlives the run that produced it.

  **A new SSR request-isolation contract — marked `pending`, because it was falsified.** The store is request-scoped through `AsyncLocalStorage`, but `getActiveInstance` falls back to the process-global `globalThis.__zintl_active`, and every existing SSR contract issues one request at a time — precisely the condition under which that fallback is indistinguishable from the correct path.

  The contract captures each locale uncontended, then interleaves them and requires every response to still match its own baseline. It passes. To find out whether that meant anything, request scoping was deliberately broken by disabling the `AsyncLocalStorage` lookup; the sabotage reached the served runtime (verified in `dist/runtime/store-core.mjs`, where the bundler had folded the branch away) and **the contract still passed**.

  The reason is the example, not the contract: `react-ssr` renders with `renderToString`, which is synchronous. There is no await between entering the request scope and finishing the render, so no second request can interleave and observe the global. The leak is unreachable here by construction.

  So it ships `pending` rather than green. The assertions and the baseline-then-interleave method are right; what is missing is a **streaming** SSR project — `renderToPipeableStream` with `injectIntoStream`, which the `streamInjection` capability and `store-server.ts` already exist to serve. One fixture away, and then one deleted line.

- 8882138: Add the three unmanifested SSR examples to the contract suite.

  `svelte-ssr`, `vue-ssr` and `vanilla-ssr` existed under `examples/` and were built by `build:examples`, but no contract had ever run against them — SSR coverage was React only. Every SSR-shaped contract now runs across four frameworks: **94 contract tests, up from 76, for about six seconds.**

  That matters most where the frameworks genuinely differ. SSR codegen for Vue and Svelte single-file components goes through different facet paths than JSX, and until now the only thing checking either in SSR mode was a production build with nothing asserting its output. The three new manifests bring `transform`, `build`, `graph` and `boundary-graph` snapshots with them — 99 of them — so a change to SFC handling under SSR is now visible as a diff rather than as a downstream surprise.

  **Their capability lists are deliberately narrower than `react-ssr`'s.** That manifest also claims `hmr`, `locale-switch` and `rtl`, and none of the three matches anything: every contract requiring them also requires `spa`, which an SSR project does not have. Inert claims cost nothing at runtime, but a capability list exists precisely to say what is covered, and one that overstates is the same failure as a contract whose body is commented out. The new manifests claim `ssr`, `boundary-graph`, `transform`, `build`, `graph` — all of which match.

  The manifest index now carries the cost model too, since this is the file where it gets decided: cost is roughly (examples × matching contracts), each manifest also brings a per-worker copy and a pooled dev server, and `fixtureSource` remains the right tool when the question is "does this one feature work" rather than "does this whole app work".

  None of the four streams — all render synchronously — so `ssr-isolation` stays `pending`. Its blocker is unchanged and now better bounded: what it needs is not another SSR example but a _streaming_ one.

- c28c3aa: Add a streaming SSR fixture, and turn the request-isolation contract from unfalsifiable to proven.

  `ssr-isolation` shipped `pending` because it could not fail. Every SSR project in the manifest renders synchronously, which leaves no window between entering the request scope and reading the store — so a request-scoped read and a read of the process-global `globalThis.__zintl_active` are indistinguishable, and the contract would have passed no matter what the runtime did.

  The new `ssr-streaming` fixture supplies the two properties nothing else had:

  - **An `await` inside the render.** One yield between entering the scope and producing translated output, which is the window a second request needs in order to observe the first's state.
  - **A `ReadableStream` return.** `injectBakedCatalogs` routes that through `injectIntoStream` — machinery that ships in every SSR build and had no test touching it at all.

  **Verified by falsification.** With the `AsyncLocalStorage` lookup in `getActiveInstance` deliberately disabled so every read fell through to the process-global, the contract failed on the fixture with **18 of 24 concurrent responses serving Arabic to English, Spanish and Chinese requests** — each one complete, well-formed, and belonging to somebody else. The four example projects kept passing throughout, correctly: they render synchronously and genuinely cannot leak. That split is the evidence the fixture was needed, and `ssr-isolation` is no longer `pending`.

  Two things about the fixture are load-bearing and easy to get wrong. Its translatable strings sit in a **template literal carrying markup**, because that is what the extractor stitches — an earlier version passed the same text as a bare argument to `encoder.encode()` and produced no catalogs whatsoever, so the contract "passed" against a page with nothing to translate. And they are built **after** the yield, since that is where a contaminated read would occur; constructing them earlier would make the fixture look like it exercised the window while proving nothing.

  Translations are seeded per locale so the four render visibly differently. The contract already refuses to run against identical baselines — a leak between locales that look the same is undetectable, and a test that cannot distinguish them should say so rather than report green.

  Suite: 100 contract tests, ~72–74 s.

- 1e25c60: Strengthen the contract suite, and stop one contract claiming coverage it does not have.

  **Two new contracts, both asserting in a real browser.** The distinction matters more than it sounds: the runtime is served as _text-substituted source_ through `getRuntimeCode`, and the one time a guard could not be folded, every development branch in the browser was dead for the project's entire life while every unit test passed. A rule that only holds against a bare `I18nStore` is not a rule that holds.

  - **Delivery Ordering** proves Axiom D1 the way `hmr-hammer` cannot. `hmr-hammer` can only observe the order the network happened to produce; it can never make an older catalog arrive _after_ a newer one. This one does, and asserts the older loses — and that it loses _by rule_, with the supersession recorded, since a correct result reached by accident is indistinguishable from one reached by rule and does not survive the next change. It asserts on the store rather than the DOM, deliberately: whether a framework re-renders is a different question with its own contracts, and asserting it here would report their failures as ordering failures.
  - **Delivery Failure** is proposal 024's acceptance criterion 2 — an abandoned boundary is observable. It exercises all three abandonment paths (rejection, empty result, synchronous throw) and requires each to be named in the ledger _with a reason_, because "it failed" and "it resolved empty" call for different fixes. It also asserts the page survives: a failed lazy boundary is not a crash.

  **`assert.localeCoherent()`** checks that the store and the document agree about the locale. `assert.locale()` only ever read `html[lang]`, so a page rendering Arabic while announcing English passed it — which is precisely the defect a superseded locale switch produced when it was still allowed to publish. Both halves were individually plausible; only their disagreement was the bug. Wired into `locale-switch` and `locale-storm`.

  **A contract can now declare itself `pending`.** `chaos-boundary` had its entire body commented out behind a known blocker, so what it actually ran was `navigateHome` plus one heading assertion — an exact duplicate of `initial-render`, reporting green and claiming the `chaos` capability while covering none of it. That is the worst state a test can be in: it occupies the slot where the real coverage would go and tells everyone the slot is filled. It is now skipped with its reason in the test report. A visible gap beats a passing test that hides one.

  **One assertion was written, measured, and removed** — worth recording because it looked rigorous and was wrong. `hmr-hammer` briefly asserted that the wire carried one packet per write. It failed on every project: 3 packets for 5 writes, consistently, while the DOM converged correctly every time. The conclusion is not that delivery is broken but that the invariant was false. **Coalescing rapid writes is correct** — two writes 30 ms apart may legitimately become one event, provided it carries the later content. Proposal 024 §1.1a is narrower than "fewer packets than writes": it is coalescing dropping the **final** state. That is what the convergence assertion already tests, and counting packets would only add a red that means nothing.

  Suite: 76 contract tests (from 72), still ~73–82 s.

  - @zintljs/extractor@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- 60517d0: - Add branding assets.
  - Update README files with improved logo branding and unified shield badges.
  - @zintljs/extractor@0.1.0-alpha.9

## 0.1.0-alpha.8

### Minor Changes

- fe9fa30: Resolve runtime dev branches at build time via a `__ZINTL_DEV__` sentinel.

  Every development-only branch in the runtime was guarded like this:

  ```ts
  typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug;
  ```

  Vite does replace `process.env` — production output contained `{}.ZINTL_DEBUG === "true"`, proving it. But `typeof process !== "undefined"` sits in front of the replaceable part and cannot be folded, so in a browser it short-circuits to `false` before the replacement is ever reached. **Client-side debug logging has therefore never produced output**, and the guard added for safety was the exact thing defeating the build-time elimination it was meant to enable.

  `__ZINTL_DEV__` is now substituted to a literal `true`/`false` by `getRuntimeCode()`, driven by the plugin's `isDev`. A literal is the point: production folds the branch away entirely, development keeps it reachable — on the client as well as the server.

  - `getRuntimeCode()` takes a new trailing `isDev` argument, defaulting to `false` so a caller who forgets gets the production runtime. The failure mode is "no debug output", never "debug machinery shipped to users".
  - `I18nStore.debug` now also honours `globalThis.__ZINTL_DEBUG` in a browser. The env-var check alone is unreachable client-side, which is the second half of why client logging never appeared.
  - Adds a development-only settle beacon: `notify()` increments `globalThis.__zintl_version`, giving test harnesses a causal signal that the store applied something instead of making them sleep and hope. Absent in production by construction.

  Verified: production snapshots contain no `console.debug` and no `__zintl_version`, and `debug = typeof process !== "undefined" && {}.ZINTL_DEBUG === "true" || false` now compiles to `debug = false`.

  Consumers importing the runtime modules directly (rather than through `getRuntimeCode()`) must define `__ZINTL_DEV__` in their bundler or test config.

### Patch Changes

- fcd99bf: Report catalog-delivery failures instead of swallowing them.

  `loadLazyBoundary` discarded every failure mode it had: a rejected promise (`.catch(() => …)`), an empty result (`if (!res) return;`), and a synchronous throw (`catch {}`). All three cleared `pendingBoundaries` and scheduled no retry — so once delivery failed, `_t` returned `""` for every key in that boundary permanently, and nothing anywhere recorded why.

  An empty string is not a missing fallback; it is a read that returned the wrong value. The compiler's integrity check guarantees catalogs are complete, so a miss at runtime means _delivery_ failed, not content — and blank UI with no trace is the worst possible way to express that.

  All three sites now report in development, naming the boundary, the locale, and the consequence. Behaviour is otherwise unchanged: no fallback, no retry, no recovery invented. This makes a silent wrong-value read a loud one.

  Worth noting why this was never seen: the only diagnostic in the whole path was a `console.warn` gated on the old `typeof process !== "undefined"` guard, which never evaluated true in a browser. Client-side, this failure mode has been invisible for the project's entire life.

  Production output is unaffected — the logging is behind `__ZINTL_DEV__` and is eliminated at build time (verified: no such strings appear in any `dist` snapshot).

  - @zintljs/extractor@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- Rename the main package from `zintl` to `zintljs`.

  npm rejects the bare name `zintl` under its package-name similarity filter (`Package name too similar to existing packages intl,vinyl`). The name is unobtainable, so the primary package is now **`zintljs`**, matching the `@zintljs` npm org and the `zintljs` GitHub org.

  **What changed for consumers:**

  ```diff
  - npm install zintl
  + npm install zintljs

  - import zintl from "zintl/vite";
  - import { zintl } from "zintl/macro";
  + import zintl from "zintljs/vite";
  + import { zintl } from "zintljs/macro";
  ```

  **What did not change:** the `zintl()` macro itself. The package name and the exported identifier are deliberately separate — `ZINTL_MACRO` still resolves the `zintl(...)` call expression, and `bindings` in the boundary graph still read `"zintl"`. Only module specifiers moved.

  Internal `virtual:zintl/*` module IDs are unchanged; they are not npm names and keep the project's brand prefix.

  `RUNTIME_PACKAGE` and `RUNTIME_SPECIFIERS` in `@zintljs/extractor`, and `MACRO_PACKAGE` in `@zintljs/compiler`, now point at `zintljs`. Because those constants are baked into the compiler's published output, `@zintljs/compiler@0.1.0-alpha.6` cannot recognize the new specifiers and is superseded by this release.

### Patch Changes

- Updated dependencies
  - @zintljs/extractor@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- 2a07272: Introduced a modular, conflict-free **Adapter Architecture** that decouples framework-specific and toolchain-specific capabilities into discrete concerns. Framework presets (`"react"`, `"vue"`, `"svelte"`, `"vanilla"`, `"html"`, `"nextjs"`) and runtime/bundler layers (`"ssr"`, `"vite"`, `"client-spa"`) compose dynamically into a resolved capabilities map. Key changes include:

  - **Environmental Runtime Splitting**: Decomposed `store.ts` into environment-gated modules (`store-core.ts`, `store-client.ts`, and `store-server.ts`). Vanilla applications now bundle only core translation states, while SPA router synchronization popstates and server request-scoped `AsyncLocalStorage` logic are loaded dynamically on demand.
  - **Vite Plugin Decoupling**: Refactored the Vite plugin config hook to utilize the compiler's presets engine, auto-injecting the `"vite"` preset and detected frameworks, which cleans up hundreds of lines of duplicate codegen and SSR wrapper regexes.
  - **Extension Preservation**: Retained full source file extensions (like `.tsx`, `.jsx`, `.svelte`, and `.vue`) in the boundary ID normalization and compiler maps to prevent naming clashes between files sharing the same base name.
  - **Boundary & Catalog Alignment**: Resolved a bug causing duplicate catalog and schema files (e.g. `App.ar.json` vs `App.svelte.ar.json`) by passing pre-resolved extensions and adapters directly to the `IOManager` constructor to unify normalized paths.
  - **Backward Compatibility**: Embedded fallback translation from `options.targets` to their preset adapters to ensure full compatibility with existing configuration blocks.

- 4031237: Consolidated the facet configuration and instantiation pattern. Replaced static facet objects and custom creation helpers with standardized function factories named `nameFacet(options?)` (e.g., `vanillaFacet()`, `assetsFacet()`, `viteFacet()`). Introduced compound facet factories (e.g., `reactFacet()`, `vueFacet()`, `htmlFacet()`, `nextjsFacet()`, and `ssrFacet()`) to return a flattened list of concerns under a single configuration entry. Relocated all preset automation and auto-resolution logic from the compiler core to the Vite plugin, making the compiler entirely logicless. Finally, renamed `ZintlOptions` to `CompilerOptions`, and re-exported all facet factories directly from the `zintl` plugin package so users do not need to install the compiler package to customize facets.
- 5be8d95: Moved facet resolution out of the compiler and into the host plugin, completing the separation the Concern-Faceted Architecture was aiming at. Knowledge now flows one way only: `extractor ← compiler (core) ← compiler/facets ← zintl (plugin)`. The compiler receives capabilities and executes them; it no longer selects, merges, validates or names a framework.

  **Compiler API.** `new ZintlCompiler(options)` now requires `options.capabilities`. `CompilerOptions.facets` and the internal `CompilerFacetInput` type are removed, and `resolveFacets` is no longer exported from `@zintljs/compiler`.

  ```ts
  // before
  new ZintlCompiler({ facets: [reactFacet(), viteFacet()] });

  // after
  import { resolveFacets } from "zintl/facets";
  new ZintlCompiler({
    capabilities: resolveFacets([...reactFacet(), viteFacet()]),
  });
  ```

  **Capability contract relocated to the compiler core.** All facet interfaces moved from `src/facet/types.ts` to `src/types/capabilities.ts` and are published from the package root. Renames: `ResolvedFacets` → `CompilerCapabilities`, `ResolvedCapabilities` → `CapabilityFlags`, `ResolvedFacetSystem` → `CompilerSystemView`. The bundle's boolean map is now reached as `capabilities.flags` rather than `capabilities.capabilities`.

  **Removed the `VITEST` facet injection.** The constructor silently pushed `htmlFacet()`, `assetsFacet()`, `vanillaFacet()` and `reactFacet()` whenever `VITEST=true` or `NODE_ENV=test`, so the compiler behaved differently under test than in production. This is why no compiler test ever passed a facet list. The facet set is now declared explicitly by the test harness.

  **Fixes uncovered by the move:**

  - **`ZintlFacet` was declared twice**, once in `dist/index.d.mts` and once in `dist/facet/index.d.mts`. Because `CompilerContext` reaches `IOManager` — a class with private fields — the two declarations were _nominally_ incompatible, which is what forced `as FacetsInput` casts on user-authored facets. `@zintljs/compiler/facets` now exports preset values only and imports the single canonical type declaration; the casts are no longer needed.
  - **The compiler hardcoded React.** `pipeline/resolve-imports.ts` injected `import { useSyncExternalStore } from "react"` for client components. Frameworks now declare this through the new `CodegenFacet.clientReactivityImports` field.
  - **`CatalogManager` and `GraphManager` hardcoded** `[".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html"]` when probing extensionless dependency ids; both now use the resolved extension list, exposed via `IOManager.resolvedExtensions`.
  - **`resolveTargets` returns a shared, memoized object** that the old resolver mutated in place, so two compilers with identical descriptors but different facet rules could clobber each other's extraction state. The new `compileExtractionState` export (also the seam that keeps the plugin free of an `@zintljs/extractor` dependency) builds the state immutably.
  - **`MergeState.hmrInjectionCode`** dropped the `hasAnchors` parameter that both `BundlerFacet` and the resolved view declare.

  **Removed two unreachable bundler hooks.** `BundlerFacet.isMultiplex` had no provider and was shadowed by `Context.getMultiplex`. `BundlerFacet.fanBuildInputs` was not merely unused but architecturally unreachable: MPA input fanning happens in the `config` hook, which runs before `configResolved` constructs the compiler, so a facet's copy could never be consulted.

  **Plugin.** `zintl/facets` now exports `resolveFacets`, plus `assembleFacets`, `autoFacets`, `flattenFacets`, `detectFrameworks`, `detectFrameworksOrFallback` and `FALLBACK_FRAMEWORK`. Framework detection and facet assembly moved out of `configResolved` into `facets/detect.ts` and `facets/assemble.ts`, leaving the hook as three visible steps: detect → assemble → resolve. The plugin's public `Options` now extends `Omit<CompilerOptions, "capabilities">`.

  **`@zintljs/testing`.** `ViteDriver.compile()` resolves capabilities the same way the plugin does instead of handing plugin-shaped options straight to the compiler. The contract snapshots consequently measure the production path for the first time — which revealed that `vue-basic` and `svelte-basic` had been asserting that Zintl performs _no_ transformation on Vue and Svelte components (the test-mode injection gave every example React facets), and that `react-basic`, `react-ssr` and `vanilla-spa-basic` were recorded with no bundler facet at all, so dev dynamic imports lacked their `/* @vite-ignore */` comment. 15 snapshots were regenerated against the correct output.

  **Enforcement.** Two architecture tests assert that no file under `src/index.ts`, `src/pipeline/`, `src/managers/` or `src/types/` imports from `./facet/**`, and that the compiler core names no framework or bundler. The 42 test files that require a resolved framework world moved to the plugin package, where resolution lives.

- 1061058: Refactored the compiler extension model from Adapters to Facets, formalizing the Concern-Faceted Compiler Architecture and Dimension-Constrained composition system. Renamed `ZintlAdapter` to `ZintlFacet`, `resolveAdapters` to `resolveFacets`, and the `adapters` configuration options to `facets` across the compiler, plugin, examples, and tests.
- 448dbc6: Made `@zintljs/extractor` genuinely framework-blind. A previous changeset claimed the extractor had been "fully decoupled" from framework presets; that was inaccurate — the tables were left in place, duplicating the facet presets, and one of them was still on a live code path.

  **Deleted from `targets.ts`:**

  - `TARGET_PRESETS` — full descriptor lists for `vanilla`, `react`, `nextjs`, `vue`, `svelte` and `html`.
  - `TARGET_METADATA` and the `TargetMetadata` type — Vue and Svelte SFC block rules, Svelte's mustache pattern, and the Next.js `generateMetadata` / `generateViewport` suppression rules.
  - `DEFAULT_SFC_RULES` and `DEFAULT_SUPPRESSION_RULES`.

  Every one of these duplicated a facet preset in `@zintljs/compiler/facets`, which is now the single source of truth. The Vue and Svelte block rules were byte-identical to their preset counterparts.

  **Removed the one live leak.** `parser.ts` fell back to `DEFAULT_SFC_RULES` whenever the caller's rules did not cover a file's extension, so any `.vue` or `.svelte` file received Vue/Svelte block-splitting from the extractor itself even when no rules were supplied. SFC rules are now caller-supplied only.

  **`TargetDescriptor` no longer names a framework.** The `"auto" | "react" | "nextjs" | "vue" | "svelte" | "html" | "vanilla"` members are gone, leaving only the structural forms (`jsx:*:attr`, `jsx:El:attr`, `dom:prop:x`, `dom:attr:x`, `obj:field:x`, `html:attr:x`) and `TargetPlugin`. `resolveTargets` is correspondingly reduced to pure structural compilation — descriptors into lookup sets, plugin collection and a fast-path regex — with no preset expansion and no rule derivation.

  **No default target set.** `parser.ts` and `context.ts` both defaulted to `["vanilla", "react", "html"]`. A framework-blind executor has nothing sensible to guess, so callers now declare their sinks; production supplies a fully compiled state from the resolved facets.

  **Removed dead sink opinions.** `DEFAULT_UI_ATTRIBUTES`, `DEFAULT_UI_OBJECT_FIELDS`, `DEFAULT_UI_SINK_PROPERTIES` and `TEMPLATE_ATTR_REGEX` encoded which DOM and JSX attributes are translatable. All four were already unreferenced — one survived only inside a commented-out line.

  **Fixed drifted runtime-specifier detection.** The check for Zintl's own module specifiers was inlined at four sites (`parser.ts`, two in `visitors/program.ts`, one in `visitors/bindings.ts`) and the copies had diverged: the `bindings.ts` variant omitted the bare `"zintl"` literal, so a project configuring a custom `runtimePackage` would have had bare `"zintl"` imports recognised by three checks and missed by the fourth. All four now call the new `isRuntimeSpecifier` helper, backed by a single `RUNTIME_SPECIFIERS` list.

  **Verification.** The contract snapshots passed with zero diffs, which is the proof that the deleted tables were dead in production. Three new architecture tests assert that the extractor names no framework anywhere in its source, exposes no preset tables, and that `resolveTargets([])` yields a genuinely empty world.

- e1e504d: Prepare the packages for their first public release.

  - **Renamed the npm scope** from `@zintl/*` to `@zintljs/*`. The `zintl` org name was unavailable on npm; the primary package remains `zintl`, so application code importing `zintl` and `zintl/macro` is unaffected. Only direct consumers of `@zintl/compiler` and `@zintl/extractor` need to update.
  - **Corrected the Vite peer range** to `^6.0.0 || ^7.0.0 || ^8.0.0`, verified by building a real app against stock Vite 6.4.3, 7.3.6, and 8.2.0. The plugin relies on the Environment API (`hotUpdate`, `this.environment`), which does not exist in Vite 5, so the previous `^5.0.0` range advertised support that could never work.
  - **Pinned `oxc-parser` and `@oxc-project/types`** to `^0.142.0` in the workspace catalog. They were set to `latest`, which would have published `@zintljs/extractor` with an unpinned runtime dependency on a pre-1.0 parser.
  - **Trimmed the publish surface** with an explicit `files` field. The `zintl` tarball drops from 91 files (535 kB unpacked) to 13 files (103 kB) — build config and sources are no longer shipped.
  - **Added `engines`, `repository`, `homepage`, `bugs`, and `keywords`** to every published package, and gave `@zintljs/compiler` and `@zintljs/extractor` their own READMEs.
  - **Moved npm provenance out of `publishConfig`** so that publishing is possible outside of CI. Provenance requires a public source repository and CI OIDC; it is re-enabled via `NPM_CONFIG_PROVENANCE` in the release workflow.
  - **Marked `@zintljs/testing` as private.** It backs the internal e2e suite only and is no longer part of the release surface.

- 3fa4428: Hardened catalog reconciliation — the subsystem that decides, when source text changes, whether a translation is carried forward or dropped. Because keys derive from the text itself, this is what makes ordinary copy edits safe, and it had three unit tests.

  **Its two failure modes are not symmetric, and the design now says so.** A _missed_ rename is cushioned: the translation hive is append-only and keyed by source text globally, so the old translation is never destroyed and `CatalogManager` restores it if that text reappears. A _wrong_ rename is not cushioned — the old translation is written under the new source text and then memorized into the hive, so one bad match propagates. Everything below follows from that asymmetry.

  **Carry-forwards are now reported.** `ReconcileResult` gains a `renamed` array recording every rename with its similarity score and a `substitutesWords` flag, and `MessageManager` surfaces them: a warning when a whole word was swapped, debug otherwise. Deletes stay quiet, because the hive already covers them.

  The flag is a risk signal, never a rejection. Edit distance cannot separate `"Enable notifications"` from `"Disable notifications"` — they are ~0.86 similar — and no threshold can, since a negation and a spelling fix are the same edit size. But a negation _substitutes a word_ while a typo fix, a punctuation change or an appended clause does not, so that shape is worth a developer's eyes. A single-word spelling fix (`"Colour"` → `"Color"`) trips it too; it still reconciles, it is just visible.

  **Matching is deterministic.** Renames were assigned by walking removed texts in manifest order and taking each one's best available partner. When two removed strings competed for the same partner, iteration order decided which kept its translations. Candidate pairs are now scored globally and assigned best-first, with ties broken on text, so the outcome is a pure function of manifest _content_ rather than ordering — and the greedy result is strictly better matched.

  **Short strings no longer fall off a cliff.** Similarity is length-relative, so `"OK"` → `"Ok"` was one edit over two characters — 0.5, under the 0.6 threshold — and a casing fix on a two-letter button was classified as a delete. The new `isRenameCandidate` applies a one-edit floor. This only ever relaxes the budget, and only where the ratio rounded below a single edit, so nothing three characters or longer changes behavior.

  **Separated two thresholds that had been conflated.** The assets facet's fuzzy matching now uses its own `DEFAULT_ASSET_DRIFT_THRESHOLD` rather than borrowing `DEFAULT_RENAME_THRESHOLD`. One asks "is this the same UI string, edited?" over short labels; the other asks "did this document change materially?" over whole file bodies. They share a value today and are now free to diverge.

  **Tests went from 3 to 26**, and are grouped around the asymmetry: the short-string budget, word-substitution reporting, and a property block covering classification exhaustiveness (every removed text lands in exactly one of rename/move/delete), invariance under manifest and boundary ordering, one-partner-per-text, closest-partner preference, no-op on unchanged manifests, and similarity symmetry.

### Patch Changes

- 448dbc6: Gave Zintl's option defaults a single home. Defaults were previously applied lazily at roughly thirty read sites across two packages, several of them duplicated with divergent rules, so answering "where did this value come from?" meant grepping.

  **`resolveOptions()` is now real.** It had been a stub whose entire body was commented out, returning `options || {}`. It now applies every context-free default once, at plugin creation, and `Context` holds the resulting `ResolvedOptions` so downstream hooks read concrete values. A new exported `DEFAULTS` table is the one place a default is written down.

  | default                               | occurrences before | after            |
  | ------------------------------------- | ------------------ | ---------------- |
  | `locales \|\| ["en"]`                 | 9                  | 0                |
  | `sourceLocale \|\| "en"` (plugin)     | 4                  | 0                |
  | `similarityThreshold ?? 0.6` literals | 3                  | 0                |
  | `["md", "txt"]` literals              | 2                  | 1 named constant |
  | harness default blocks                | 2                  | 1                |

  **Three defaults stay unresolved on purpose**, because only Vite can supply them. Each is documented in `DEFAULTS` and applied at exactly one site: `multiplex` (`undefined` → auto-detect by scanning entry files), `verifyIntegrity` (`undefined` → on for `build`, off for `serve`) and `logLevel` (`undefined` → fall back to Vite's own, then `"info"`). `logLevel` previously had three stacked defaulting layers and `verifyIntegrity` three rules that disagreed, one of which relied on spread ordering to let a user value win.

  `outputDir`, `catalogFormat`, `metadataDir` and `similarityThreshold` are deliberately left unset by the plugin so the compiler applies its own — re-stating them would recreate the duplication being removed.

  **Fixed a shared-array aliasing bug** found while writing the new tests: the default `locales` array was a single instance handed to every caller, so one plugin instance mutating its locale list would corrupt another's. Array defaults are now copied per call.

  **Compiler-side deduplication.** `DEFAULT_RENAME_THRESHOLD` is exported from `reconcile.ts` and reused by the assets facet, which had hardcoded `0.6` three times. The assets facet's `["md", "txt"]` default is a named constant instead of two inline literals. `AssetFacetConfig` drops its `assetsTarget` alias, so the concept is spelled `targets` at the facet level and `assetsTarget` at the plugin level, bridged in exactly one commented line in `facets/assemble.ts` — previously three spellings reconciled by a rename inside the factory. `IOManager` takes a narrow `IOManagerOptions` (just `metadataDir`) rather than the whole `CompilerOptions`, and its duplicated metadata-directory resolution is collapsed into one method.

  **Removed dead configuration.** The `ZINTL_TEST_OUTPUT_DIR` / `ZINTL_TEST_METADATA_DIR` environment overrides were read in `configResolved` but nothing in the repository ever set them. The test harness's Vite alias pointing at `packages/runtime/src/*` referenced a directory that does not exist.

  **New coverage** for territory that had none: `resolveOptions` pins every documented default and asserts that falsy user values survive, and `flattenFacets` / `autoFacets` / `assembleFacets` are tested directly — including that `viteFacet()` is always injected and that the generic SSR facet is never paired with Next.js, which would otherwise be a facet conflict.

- 51261a9: Decoupled static asset localization (`AssetManager`) and HTML catalog/schema projection (`HtmlManager`) from the hardcoded execution paths of the compiler. Created the generic `ContentAdapter` interface and a stable `CompilerContext` API, migrating the manager behaviors into pluggable system content adapters (`staticAssetsAdapter` and `htmlProjectionAdapter`).
- 7e02023: Fully decoupled the remaining hardcoded knowledge of assets and HTML projections below the adapter resolution layer. Refactored `CatalogManager` and `GraphManager` to genericize virtual boundary tracking and content checks via resolved content adapter hooks, eliminating direct imports and usage of manager classes in the compiler core.
- 3fd61d3: Ensure deterministic boundary and chunk graph serialization by implementing deterministic sorting helpers:

  - **Deterministic Serialization**: Added the `serializeDeterministic` utility to recursively format and sort `Map` keys, `Set` elements, and arrays of objects (such as `BoundaryDep` lists) by stable properties (e.g. `id` or `name`).
  - **Strict ESLint Compliance**: Included a localized string comparison helper `compareStrings` to satisfy array sort checks without the performance overhead of Unicode-based `localeCompare`.
  - **Contract Tests Snapshot Stability**: Updated the contract graph test suite to utilize the new deterministic serializer, preventing random reordering failures on successive test runs.

- a7f080f: Fully decoupled high-level framework presets (`"vue"`, `"svelte"`, and `"nextjs"`) from `@zintljs/extractor`'s core logic. The extractor has no hardcoded references to these framework target-presets, meaning all SFC block parsing rules, metadata suppression rules, and mustache regular expression patterns now flow downward from compiler-resolved adapters.

  Evolved the extractor's mustache rule matcher to dynamically match intermediate or virtual file extensions (e.g. `.vue.html` and `.svelte.html`) to ensure correct template variable extraction and production catalog baking in Vue and Svelte.

- fdda8fa: Refactored the compiler and Vite plugin wrapper to establish a fully adapter-driven modular architecture. Eliminated hardcoded fallbacks for extensions in the plugin wrapper config resolved hooks. Preserved physical JSON catalog formats for robust schema-enforcements, auto-healing, and recovery. Added support for custom Handlebars SFC template block extraction and dynamic runtime multi-brand slogans resolution, utilizing robust regex rewriter hooks. Added type definitions for SFC identification on codegen contributions. Unified the HTML projection preset adapter with the compiler's extraction manifest to merge standard extracted text keys and metadata (such as titles, descriptions, and directions) into the generated schemas, resolving validation conflicts under `additionalProperties: false`.
- 72acaa8: Expanded SSR entry point file extension matching in the compiler presets to support JSX/TSX:

  - **SSR JSX/TSX Entry Wrapping**: Added support for `.tsx` and `.jsx` file extensions when detecting and wrapping server entry points inside `runInRequestScope` in the `ssr` and `nextjs` presets.

- Updated dependencies [448dbc6]
- Updated dependencies [a7f080f]
- Updated dependencies [e1e504d]
  - @zintljs/extractor@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- 3ceeaf3: Upgrade the Zintl compiler to fully support backing up, restoring, and similarity matching (fuzzy reconciliation) of static translation assets in the global Hive:

  - **Move & Rename Auto-Recovery**: Stored asset targets indexed by their source content hash (`@zintl/asset-hash:<sha1>`) instead of absolute paths. This allows automatic translation restoration at the new location when a source asset is moved or renamed.
  - **Binary/Image Asset Backups**: Implemented Base64 encoding/decoding to safely back up localized binary assets in `hive.json` and restore them back as raw binary buffers.
  - **Target Pruning**: Updated the asset manager to proactively delete localized target files from disk when their source asset is deleted or moved, working seamlessly in development/HMR mode.
  - **Fuzzy Modification Reconciliation**: Implemented Levenshtein-based similarity matching for text and Markdown assets. If a source asset changes slightly (either at the same path or during a move), Zintl now preserves the translator's existing translation and prepends a review warning rather than overwriting it entirely.

- a16cedd: Evolved the compiler to be completely framework-agnostic (zero-knowledge) by eliminating all default `.vue` and `.svelte` fallbacks from the core extensions and search paths. Configured the host Vite plugin to dynamically calculate target extensions and pass them to the compiler. Refactored the React target adapter matching rule to dynamically exclude registered SFC extensions and HTML files without hardcoding Vue or Svelte.

  Abstracted dynamic imports and virtual module paths inside the compiler. Added `resolveVirtualPath` and `dynamicImportTemplate` options callbacks, allowing any host bundler plugin to configure custom virtual namespaces (e.g. queries) and ignore-comments (e.g. webpackIgnore/vite-ignore) dynamically.

- b7a327e: Fixed HMR rendering issues and resolved timing race conditions during source translation updates:

  - Updated the translation resolver (`_t`) to immediately re-evaluate catalog lookups after synchronous self-registration, preventing blank rendering.
  - Propagated HMR timestamps (`lastHMRTimestamp`) on all invalidated virtual modules in `handleHotUpdate` to ensure Vite's `importAnalysis` rewrites imports with correct timestamp query parameters.
  - Introduced automated page auto-refresh (full-reload) for server-side (SSR) only boundaries and catalogs when modified.

- 97733bb: Fix phantom boundary integrity errors and phantom asset output for projects without a `zintl()` anchor:

  - **`verifyIntegrity` — phantom boundary guard** (`packages/compiler/src/index.ts`): Added an early exit when `bg.entries.size === 0` so that projects with no trust anchors (e.g. a freshly migrated Next.js / vinext app) no longer throw `[Zintl Integrity Error]` for strings extracted by the aggressive stitching engine. When anchors do exist, tightened `isReachable` to check actual reachability from an entry point via `getStaticDependencyTree` instead of mere membership in `bg.nodes`, so phantom boundaries that live outside the anchor dependency chain are silently skipped rather than integrity-checked.

  - **`AssetManager` — phantom asset write guard** (`packages/compiler/src/managers/AssetManager.ts`): Extended `isAssetUsed()` with a boundary graph anchor check that fires only when real Vite module-graph information is available. If the Vite dep graph is populated but `bg.entries.size === 0`, the asset is classified as a phantom and `syncSingleAsset()` returns early without writing any localized output file. In isolated mode (unit tests, programmatic API usage without a Vite instance) the dep graph is empty so the original "assume used" fallback is preserved, keeping all existing asset tests passing.

- a64c32c: Fixed React HMR support, nested entry point reachability checks, and documented the synchronous catalog injection behavior:

  - Corrected boundary graph reachability traversal (`isReachable`) to resolve file paths against target nodes, fixing HMR invalidation failures for nested/bootstrap anchors.
  - Documented the framework-agnostic Synchronous HMR Catalog Injection in `SPEC/ZHMR.md` which leverages Vite's execution order to update the active translation store before component re-renders, rendering manual store subscriptions obsolete.

- 0bd00a8: Fix evaluation of dynamic attributes, tag replacement, and boundary resolution in JSX/SFC compilation:

  - **Export and Import Boundary Resolution**:
    - In `@zintl/extractor`: Maps default and named exports of components to their precise function-level boundary IDs (e.g., `src/App:App` instead of the file boundary `src/App`) in the program visitor.
    - In `@zintl/compiler`: Resolves static import bindings to their precise exported function-level boundary IDs when walking the dependency graph in `intent-utils.ts`, and adds file-level fallback resolution to ownership mapping checks.
  - **Dynamic JSX Attribute Evaluation**: Serializes `_tags` for JSX components as raw JavaScript array literals rather than JSON strings, allowing local scope variables (like imported assets) to be correctly evaluated at runtime.
  - **JSX to HTML Attribute Mapping**: Automatically maps `className` to `class`, and JSX attribute expressions like `src={logo}` to template literal interpolations `src="${logo}"` for elements inside translated templates.
  - **Self-Closing Tag Placeholders**: Extends the runtime key resolver and compile-time baking to support self-closing tags (both `<tag/>` and `<tag />`) when replacing translatable element placeholders.

- 7dd0bfb: Fix HMR script injection for Vue and Svelte SFC components. The compiler now detects the closing `</script>` tag in single-file components and embeds the HMR acceptance code block inside it instead of appending it raw at the end of the file, preventing template syntax compilation errors.

  Additionally, Zintl now injects a dynamic boundary HMR revision token comment in development mode for transformed components. This forces SFC compilers (like Svelte) to generate a modified signature upon catalog invalidation, prompting Svelte's HMR proxy to correctly swap and re-render component instances when translation catalogs change.

- 372448e: Fixed HMR updates for shared and lazy components by resolving entry manager chunks through boundary graph reachability traversal:

  - Updated `getAffectedChunks` to map safe/sanitized boundary IDs back to their physical files.
  - Performed depth-first reachability search to correctly track and invalidate entry managers for any component containing translations.

- f7ee691: Fix compiler caching of boundary environment registrations in SSR setups. Boundaries are now tracked and added to `ssrBoundaries` or `clientBoundaries` on every transform call, bypassing the compile-time AST observation cache. This prevents false-positive "server-only" HMR reload events during client-side hydration.
- a9942b8: Shared server-side AsyncLocalStorage and registry store context on globalThis to prevent request context leaks and hydration mismatches across RSC and SSR environments:

  - Shared request-scoped `storeStorage` (AsyncLocalStorage), `globalRegistry`, `defaultInstance`, and `currentInstance` on `globalThis` in the runtime compiler store to bridge the RSC and SSR execution scopes on the server.
  - Restored standard Vite HMR catalog hot updates by reverting the experimental full-reload trigger for catalog updates.
  - Improved the missing key warn log in translation resolver to print the target boundary ID (`targetBId`) instead of the manager ID.

- 8f51ff6: Added configuration-driven SSR/RSC request isolation support for virtual entry points, zero-config framework auto-detection, and robust URL parsing:

  - Added configuration properties `ssrEntryTargets`, `ssrWrapDefault`, and `ssrWrapExports` to `ZintlOptions` to support generic wrapping of entry points with `runInRequestScope`.
  - Added zero-config auto-detection and defaulting of SSR options (`ssrEntryTargets`, `ssrWrapDefault`, `ssrWrapExports`) for the `nextjs` target (e.g. Next.js / Vinext entries) when using the default target configuration.
  - Robustly extracted the locale from incoming request URLs containing protocols, hostnames, query parameters, or hashes during request-scoped store initialization in `runInRequestScope`.
  - Allowed transformation and request isolation wrapping on registered virtual entry targets (such as `virtual:vinext-rsc-entry` and `virtual:vinext-server-entry`) by bypassing extension and virtual module early returns in the compiler transform process.
  - Updated `zintl` Vite plugin config and transform hooks to forward the new parameters and allow processing of virtual module paths matching `ssrEntryTargets`.

- a6aabcf: Introduce **Virtual Assets Mode** (zero-disk asset reference compilation) to allow building and resolving localized static translation assets purely in memory:

  - **Virtual Assets Configuration**: Added the `virtualAssets?: boolean` option to compiler settings to bypass writing target files to the local filesystem during compilation.
  - **In-Memory Translation Registry**: Integrated localized catalog generation directly with the translation Hive, dynamically retrieving and fuzzy-matching translations virtualized in memory.
  - **Vite/Rollup Asset Emission**: Configured the plugin hooks to map target asset imports to virtual modules (`\0virtual:zintl/asset/...`), emitting optimized and hashed static assets directly via Rollup's `this.emitFile()` API.
  - **Support for raw text and binary loaders**: Supports loading virtualized text and Markdown files under standard and `?raw` loader streams, exporting translated strings as JS modules.

- Updated dependencies [85504fe]
- Updated dependencies [0bd00a8]
  - @zintl/extractor@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- 365d1d2: Fixed boundary resolution and dependency reachability for exported bindings and entry point content modules.

  - Registered candidate boundaries defined in `exportedBoundaries` (e.g. `src/main:createApp`) into the compiler's boundary graph, ensuring that static reachability traversal chains are not broken by named exports.
  - Expanded entry-point content catalog generation (for target locales like `ar`, `es`, `zh`) to always inline and collect all statically reachable boundaries, aligning their structure with the manager's source locale catalog.

- a6ab4f6: Fixed SFC extension normalization in chunk and metadata resolution. Standardized metadata lookup in `getMeta` to resolve `.vue` and `.svelte` files and aligned internal path normalization to only strip JS/TS source extensions (preserving Vue/Svelte extensions), preventing empty catalogs for SFC-level anchors.
- 365d1d2: Fix production SSR client hydration mismatch and Vue SFC multiplex caching:

  - Virtualize Vue and Svelte SFC paths by locale (e.g. `HelloWorld.zintl-ar.vue`) in `resolveIdHook` and `loadHook` to prevent descriptor caching collision in the SFC compilers.
  - Normalize localized virtual SFC paths back to clean original paths in `packages/compiler/src/managers/IOManager.ts`.
  - Allow relative imports within virtualized `.zintl-` SFCs to propagate their locale and get virtualized rather than returning raw clean paths immediately.
  - Skip processing Vue and Svelte virtual sub-requests in `loadHook` and `transformHook` to prevent overriding pre-compiled blocks with raw template blocks.
  - Trim catalog key matching and variable mustache lookups with padding preservation in the compiler pipeline to ensure translations match and preserve leading/trailing whitespace.

- Updated external dependencies:
  - @formatjs/icu-messageformat-parser@^3.5.10
  - @types/node@^24.12.4
  - magic-string@^0.30.21
  - typescript@^5.9.3
- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.4

## 0.1.0-alpha.3

### Minor Changes

- 776aca8: Introduce Single File Component (SFC) extraction/transformation for Vue and Svelte, automatic target resolution, and performance optimizations:
  - **SFC Extraction Support**: Added support for `.vue` and `.svelte` templates and scripts in `@zintl/extractor`. Implemented script block slicing, tag stripping, and position/offset translation for variables, transforms, and locations to map them correctly back to the original source file.
  - **Vue & Svelte Target Presets**: Expanded Target Presets to include comprehensive configurations for Vue and Svelte elements (e.g., translatable attributes like `alt`, `placeholder`, `aria-label`).
  - **Dynamic HTML & Attribute Wrapping**: Added support for SFC-aware rewriting in `@zintl/compiler`. HTML text nodes with dynamic nested tags are automatically wrapped in framework-specific logic (`<span v-html="...">` for Vue, `{@html ...}` for Svelte), and normal text interpolations map to `{{ ... }}` or `{ ... }`. HTML attributes are transformed into reactive bindings (`:attr="..."` or `attr={...}`).
  - **Automatic Target Detection**: Added an `auto` option to the plugin targets. It dynamically queries the project `package.json` dependencies and Vite plugin configurations to auto-configure appropriate extraction targets.
  - **Compiler Flush Performance Recovery**: Optimized the compiler's warm-path flush latency to resolve benchmark regression:
    - Cached the reachable graph nodes in `ZintlCompiler` (`reachableCache`) to avoid repetitive DFS traversals per locale/boundary.
    - Implemented string comparison caching (`lastManifestContent`) for metadata manifests in `MessageManager` to bypass redundant disk writes/reads.
    - Bypassed empty synchronization tasks for assets and HTML projections when there are no updates.
    - Added on-disk verification caching (`confirmedOnDisk`) for catalogs and schemas to avoid multiple expensive `fs.exists` checks on subsequent rebuilds.
  - **Vite Transform Query Safety**: Configured the transform hook in the Vite plugin to skip transforming modules containing query parameters unless they are explicitly tagged with `zintl-multiplex=`, avoiding conflicts with non-JS file assets.
  - **ICU Baker Warnings**: Refined ICU message checking warnings to bypass mustache expressions (`{{ ... }}`) and focus warnings only on actual syntax errors.

### Patch Changes

- 18a7166: Bypassed code transformations and catalog generation/pruning for non-zintlized files and projects:

  - **Bypass Transformations for Non-Zintlized Projects**: Updated the compiler transform pipeline to check for the presence of Zintl entry points/anchors in the project, completely skipping AST transforms and manager injection for projects with zero active entry points (like the `vanilla-ssr` example).
  - **Conditional Vitest Testing Support**: Allowed unit tests checking isolated transforms to continue running in Vitest by identifying test environment file contexts and selectively bypassing the anchor-check.
  - **Dynamic Catalog Restriction**: Updated the catalog manager to skip syncing and pruning boundary catalogs when zero active entry points exist.
  - **Test Coverage**: Added dedicated unit test coverage verifying that non-zintlized source files with UI sinks remain untransformed when no Zintl entry points are present.

- 18a7166: Added support for inline SVG elements during HTML/JSX parsing and resolved fanned routing redirect intercepts in development mode:

  - **SVG Phrasing Elements Support**: Added common SVG child tags (`use`, `path`, `circle`, `rect`, `g`, etc.) to the list of inline phrasing tags. This prevents HTML/JSX text stitching from partitioning at unrecognized sub-tags, eliminating unmatched closing tag validation errors and schema warnings during catalog compilation.
  - **Fanned Routing Support in Dev Mode**: Updated the Vite development index HTML interception logic to inspect both the filesystem path and request path. This prevents custom SSR development servers from rendering empty redirect shells when navigating fanned localized routes.
  - **Request-Scoped SSR Compilation**: Restricted contextual anchor locale baking in the compiler transform when performing server-side builds. This ensures that multi-locale Express/custom SSR servers can generate request-scoped translations dynamically.

- 18a7166: Added support for Server-Side Rendering (SSR) request context isolation and automatic client-side locale inheritance:

  - **SSR Request Scope Isolation**: Integrated compile-time wrapping of the server entry point's exported `render` function inside `runInRequestScope` to prevent request state pollution.
  - **Client Locale Inheritance**: Added client-side oracle mechanism to automatically read and hydrate locale from `document.documentElement.lang`.
  - **Sequential Runtime Builds**: Updated build commands for packaging compiler runtime targets sequentially, avoiding shared chunk collision in virtual imports.
  - **Idempotency Guard**: Added protection in compiler transform to prevent double-wrapping render exports if transformed multiple times during build execution.
  - **Redirect Loop Resolution**: Added path check guards in the client-side redirect script to prevent infinite redirect loops on fanned locale endpoints.
  - **SSR appType Support**: Bypassed DevServer HTML-interception middleware when Vite configuration specifies `appType: "custom"`, allowing Express/custom SSR servers to manage routing and server-side redirection cleanly.

- 776aca8: Fix HTML catalog generation pollution in SFC templates, ignore only-variable text nodes, and optimize translation loader generation:

  - **SFC Catalog and Schema Sanitation**: Prevent `.vue` and `.svelte` files from being incorrectly identified as HTML document projections. This stops the creation of schema files and catalog files containing page-level settings (like `dir`) for SFCs.
  - **Variable-Only Text Node Omission**: Ignore text nodes inside Vue/Svelte SFC templates that only contain variables (e.g. `{{ l.name }}`), avoiding empty translation key generation (`"{var0}"`).
  - **Kingdom-Based Loader Optimization**: Optimize the compilation rewrite of the `zintl` macro. If a boundary manager (and all of its child boundaries/colony files) does not contain any translatable messages or asset dependencies, it is omitted from loader registration to minimize runtime initialization overhead.

- Updated dependencies [776aca8]
- Updated dependencies [18a7166]
- Updated dependencies [776aca8]
  - @zintl/extractor@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Introduce universal target presets, configurable assets mapping, and testing suites:

  - **Target Preset Customization**: Added framework target presets (`react`, `vanilla`, `html`) and a Target DSL in the extractor, allowing developers to configure translatable attributes, sinks, and object property targets.
  - **Universal Asset Targets (`assetsTarget`)**: Added support in the compiler for glob-based asset routing configurations, supporting strategy overrides (such as binary pass-through, text pass-through, frontmatter) and custom strategy callbacks.
  - **Catalog Group-by Path Routing**: Grouped asset catalogs by locale and original relative paths to prevent collisions across multiple files sharing identical basenames.
  - **Testing Verification**: Created dedicated unit test suites covering targets preset expansion, Target DSL parsing, resolver caching, extractor targets integration, and custom asset strategy callback execution.
  - **Decoupled Reference Calibration**: Decoupled the benchmark calibration step from extractor implementation, running it as a pure JS mathematical loop to stabilize execution speed measurements and prevent false budget regression alerts.

- Updated dependencies
- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Rebranded the primary Vite plugin package from `@zintl/vite` to `zintl` to serve as the unified main entry point. Updated the compiler import resolution pipelines, extractor AST visitor patterns, configurations, and example imports to resolve and load from `zintl` and `zintl/macro`.

### Patch Changes

- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `@zintl/vite/macro` has been streamlined as a lean, zero-dependency facade.
- be116c3: **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🟢 1 benchmark(s) improved (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                         | Baseline | New Run                        | Calibrated Delta | Status    |
  | :-------------------------------- | :------- | :----------------------------- | :--------------- | :-------- |
  | Colony HMR Latency (Manager Sync) | 415.9 µs | 391.0 µs (385.2 µs calibrated) | -7.38%           | 🚀 Faster |

### Patch Changes

- Updated dependencies
  - @zintl/extractor@0.1.0-alpha.0

## 0.0.3

### Patch Changes

- be116c3: **⚡ Performance Benchmark Changes Detected**:

  **Summary:** 🔴 1 benchmark(s) regressed (normalized and calibrated against Reference Calibration machine-speed differences).

  | Benchmark                         | Baseline  | New Run                          | Calibrated Delta | Status       |
  | :-------------------------------- | :-------- | :------------------------------- | :--------------- | :----------- |
  | Extractor Baseline (Full Project) | 1010.9 µs | 1064.4 µs (1075.7 µs calibrated) | +6.41%           | ⚠️ Regressed |

- Updated dependencies [d2d7d9b]
  - @zintl/extractor@0.0.3

## 0.0.2

### Patch Changes

- Optimize compiler pipelines to handle collapsed phrasing tag mappings:
  - **Deduplicated Pipeline Support**: Propagates deduplicated tagMaps through the observation, rewrite, and baking pipelines to align with normalized phrasing tag configurations.
- Updated dependencies
  - @zintl/extractor@0.0.2

## 0.0.1

### Patch Changes

- Fix and optimize compiler HMR, variable shadowing, and generalized page fanning:

  - **HMR Optimization**: Streamlined file caching and fanning checks in the transform pipeline to avoid redundant physical reads during normal dev/HMR fanning, lowering HMR warm-path latency to under `0.002ms`.
  - **Generalized HTML Page Fanning**: Removed hardcoded `index.html` fanned-out catalog generation bounds, fully supporting arbitrary HTML subpage fanning (e.g. `about.html`) with correct `lang`/`dir` metadata.
  - **Variable Shadowing Resolution**: Renamed overlapping `meta` definitions in the HTML projection engine to prevent silent `TypeError`s, fully restoring `deltas` and `rtl` switcher scripts.

- Updated dependencies
  - @zintl/extractor@0.0.1
