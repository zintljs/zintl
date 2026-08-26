# Proposal 035: Localized Assets Are Authored, Not Derived

**Status**: BUILT — implemented 2026-08-26, in one arc rather than §9's three steps. The model
stands and is measured rather than argued (§5.1). **§12 records what building it changed about this
document**: two claims that were wrong, one open question the code answered, and one defect the
implementation found that no amount of reading had. Supersedes the direction of
[034](034-content-facets-and-the-assets-preset.md) §3–§7, whose findings stand.
**Date**: 2026-08-25, revised 2026-08-26
**Kind**: Design proposal. Part simplification, part feature — §8 is where the original draft had
that wrong.
**Decided 2026-08-26**: no copying for any type, text or binary (§3, §4.1); the hive keeps identity
and stores no bytes (§5.2); `similarityThreshold` leaves the asset facet (§4.1). The goal these serve
is stated in §0.1 — a default that is predictable without reading the preset, and customisable
without configuring a procedure.
**Depends on**: [034](034-content-facets-and-the-assets-preset.md) for the audit, ZRS §14 for the
current model, and the no-fallback rule (ZRS §5, `verifyIntegrity`).

## 0. The reframe

The assets preset assumes a localized file is **derived** from its source: parse it, translate what is
translatable, carry the rest across, and warn when the source drifts. Every special case in it —
frontmatter parsing, body hashing, similarity scoring, hive backups, the "please re-translate"
warning — exists to serve that assumption.

The assumption does not survive contact with the content people actually localize. A German legal
PDF is not derived from the English one. A photograph of the Tokyo storefront is not derived from the
Paris one. A dubbed audio track, a right-to-left poster, a table of branch addresses — **none of these
are transformations of the source.** They are separate artifacts that occupy the same slot.

> **Localization is not translation.** Translation is one thing that can happen inside a localized
> artifact; it is not the relationship between the artifact and its source.

The relationship is **positional**: the source declares that a slot exists, where it is used, and what
its identity is. A localized asset fills that slot for one locale. Content never crosses between them.

## 0.1 What this is for

The reframe is the argument; this is the goal it serves, and the standard the result should be judged
against.

**Predictable.** One rule, stated in a sentence, true of every format: a targeted file gets an empty
artifact per locale, and a person fills it. No project should have to read the preset to find out
what will happen to a `.rst`, and no format should behave differently from another because of a
branch nobody knew about.

**Customisable without configuring a procedure.** What a project genuinely knows better than the
compiler is _which files are targeted_ and _where artifacts go_. Those stay configurable. What is
gone is every option that selected a **behaviour** — because behaviour is what the compiler should
have exactly one of.

**Less procedure, not more options.** 034 §3 proposed making the hardcoded strategy table declarable,
which is the reasonable fix if the procedures must exist. The better answer, available only once §3
removes derivation, is that the table has nothing in it. A default that cannot surprise you needs no
knob to correct it.

## 1. What the audit found

[034](034-content-facets-and-the-assets-preset.md) §1 stands, with two corrections recorded in §1.3
below. Two of its findings become load-bearing here:

- **§1.1** — the merge strategy is resolved once and re-derived five times from the file extension.
- **§1.6** — `assetsTarget` is silently discarded when a project supplies its own assets facet.

### 1.1 `verifyIntegrity` skips assets outright

`packages/compiler/src/index.ts:3140`:

```ts
if (bId === "b_assets" || (bId as string).startsWith("b_assets:")) continue;
```

|          | Missing translation                               |
| :------- | :------------------------------------------------ |
| A string | Build fails, naming the file and the catalog path |
| An asset | Build passes, ships the source-locale bytes       |

A byte-identical scaffold is a **source-locale fallback**, which the project's first rule forbids.
The scaffold itself is not the defect — it is the same idea as an empty catalog entry, something to
replace. The defect is that nothing distinguishes an untouched one from a finished one, ever.

### 1.2 The scaffold is not the only fallback — there are three more, at every layer

Found while verifying §1.1, and the reason removing the `continue` is necessary but **not sufficient**.
The asset path falls back to the source locale at resolution, at load, and at runtime:

| Site                   | Layer             | What it does when the localized artifact is missing |
| :--------------------- | :---------------- | :-------------------------------------------------- |
| `hooks/resolve.ts:204` | `resolveId`       | Resolves the import to the **source** file          |
| `hooks/resolve.ts:526` | `load`            | Returns the **source** content                      |
| `hooks/resolve.ts:553` | generated runtime | `_t(assetKey, …) \|\| sourceContent`                |

The third is the sharpest: `|| sourceContent` is a source-locale fallback compiled into shipped code,
which is the exact construct ZRS §5 exists to forbid, sitting in the one content path nobody gated.

**Consequence for this proposal.** Empty scaffolds (§5.1) do not remove these — they change what the
fallbacks are hiding. A zero-byte file makes `existsSync` **true**, so `:204` and `:526` stop falling
back and start serving nothing, while `:553` still falls back because an empty catalog entry is
falsy. Whichever way each site lands, none of them is the loud failure §1.1 asks for. All three must
change with this proposal, not after it — see §6.1 for what dev does instead.

### 1.3 Two corrections to 034 §1

Recorded here because this proposal cited 034 §1 as standing in full, and it does not quite:

- **034 §1.3 overstates.** "The plugin does not ask it" is wrong: `isSupportedAsset` **is** called, at
  `hooks/resolve.ts:144`, `:172`, and `:285`. The extension literals survive only in the _load_ path
  (`:374`, `:499`, `:502`). The fault is the plugin disagreeing with itself across two hooks, not the
  host ignoring the facet — a smaller fix than 034 describes, and a worse look.
- **034 §1.4 is conditional, not structural.** `getAssetPath` has a branch (`assets.ts:479–486`) that
  writes directly under `outputDir` whenever `catalogFormat` is absent or multilingual, which is the
  default. The catalog coupling and the `.json` collision live on the _other_ branch. The guard 034 §6
  proposes is still worth having; "assets and catalogs share one namespace by construction" is too
  strong.

Neither correction changes what this proposal does. 034 §2 — that a content facet should _declare_
its ownership rather than only answer about it — is untouched by either, and by this proposal (§9).

## 2. The taxonomy, and why it collapses

Working out what a per-locale artifact can be produced four kinds:

| Kind         | Produced by                         | Complete when       |
| :----------- | :---------------------------------- | :------------------ |
| **Derived**  | Zintl translates the text inside it | Its catalog is full |
| **Authored** | A person writes the variant         | It exists           |
| **Adapted**  | A person supplies different values  | It exists           |
| **Shared**   | Nobody — identical in every locale  | Always              |

Then two observations remove three rows.

**`Shared` is not a kind, it is the absence of a target.** An asset identical in every locale is one
you never targeted. Targeting _is_ the declaration that a slot varies by locale, so nothing needs to
say "this one does not" — and a project that later wants a per-locale logo simply targets it.

**`Derived` and `Adapted` behave identically once content stops flowing** (§3). Both are files a
person writes; the compiler's involvement is the same for a translated Markdown page as for a table
of branch addresses.

What is left is one kind. **A targeted asset is authored per locale**, and the model has no cases.

## 3. Content never crosses the boundary

The compiler MUST NOT copy content from a source asset into a localized one, and MUST NOT compare
them.

**Not copy**, because a byte-identical file is a source-locale fallback wearing a scaffold's clothes
(§1), and because for most content the copy is meaningless: an English PDF placed at the German path
is not a German PDF, it is a bug with a filename.

**Not compare**, because a source change does not imply a localized change and the compiler cannot
tell which kind of change it was. A typo fix in the English Markdown does not invalidate the Arabic.
Re-cutting the source video at a different bitrate does not invalidate the dubbed one. Warning on
every source edit trains people to ignore the warning, which costs more than the warning was worth —
and for binary content the comparison is not merely unreliable but meaningless.

The editorial question _"has the German version fallen behind?"_ is real and belongs to a person, or
to a TMS ([032](032-export-import-facets.md)), and not to a compiler that can only see that bytes
differ.

**One comparison remains, and it is a different one.** Comparing a source asset to _its own previous
state_ is identity tracking, not derivation — it answers "did this move?", never "is that stale?". §5
requires it, and it never reads or writes a localized artifact's content.

| Comparison                  | Answers                               | Verdict                                              |
| :-------------------------- | :------------------------------------ | :--------------------------------------------------- |
| Source ↔ localized          | "has the translation fallen behind?"  | **Forbidden** — unanswerable, meaningless for binary |
| Source ↔ its own last state | "did this asset move or get renamed?" | **Required** — §5.2                                  |

## 4. What this deletes

Almost all of the preset's complexity is in service of §3's two prohibitions:

| Removed                                                                    | Why it existed                                                                 |
| :------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| `AssetMergeStrategy`, every value **and its function form**                | Nothing merges any more                                                        |
| `AssetTargetConfig.strategy`                                               | The public spelling of the same thing                                          |
| Frontmatter parsing, `getAssetBody`                                        | Only needed to hash a body for comparison                                      |
| The five extension re-derivations (034 §1.1)                               | Nothing left to re-derive                                                      |
| Asset similarity scoring, `similarityThreshold` on the facet               | Nothing compared — and see §4.1                                                |
| Hive backups of asset _content_, including base64 of binaries (`:295–312`) | Nothing is restored from them. §5.2 keeps the hive for _identity_, never bytes |
| "Source content has changed. Please re-translate."                         | §3                                                                             |
| Byte-for-byte scaffolding, for **binary as well as text**                  | §1 — it is the fallback                                                        |

The function form is worth naming separately, because it was the escape hatch and it is the clearest
case: `(source: Buffer, existing: Buffer | null, locale: string) => Buffer`
(`types/compiler.ts:17-21`) takes the source bytes and returns the localized ones. That signature
_is_ content crossing the boundary. A hook cannot be kept as "the general case" of a thing §3
forbids.

**No file type is special after this, so no file type needs naming** — in the _model_. `.docx`,
`.pdf`, `.mp4`, `.webp`, `.mdx`, `.json` and `.txt` are authored under one rule, which is the answer
to _"should we hardcode every kind of file?"_: there is nothing left to hardcode, and the table 034 §3
proposed making declarable disappears rather than moves.

> [!IMPORTANT]
> This claim is about **authoring**, not **delivery**. Nothing is parsed, merged or compared for any
> type — but how an artifact's bytes reach the browser is necessarily two-mode, and §5.3 no longer
> pretends otherwise. The original draft carried the uniformity claim one layer too far.

### 4.1 What the facet's configuration becomes

The deletions are not only internal. The preset's public surface shrinks to the part that was never
procedural:

| Surface                                | Was                                        | After                              |
| :------------------------------------- | :----------------------------------------- | :--------------------------------- |
| `AssetTargetConfig.targetPattern`      | Which files are targeted                   | **Kept**                           |
| `AssetTargetConfig.outputPattern`      | Where artifacts are written                | **Kept**                           |
| `AssetTargetConfig.strategy`           | How a copy is built from its source        | Deleted                            |
| `AssetFacetConfig.targets`             | What to target                             | Kept — 034 §8 decides its spelling |
| `AssetFacetConfig.virtualAssets`       | Serve from virtual modules instead of disk | Kept                               |
| `AssetFacetConfig.similarityThreshold` | When a remembered translation is reused    | Deleted                            |

What survives on `AssetTargetConfig` is exactly its **positional** half — where sources are and where
artifacts go. The half that described a procedure is gone, and with it the last reason the preset had
to know what a file format is.

**`similarityThreshold` goes because it is in-house config, not because `0.6` was the wrong number.**
The facet declares its own knob (`assets.ts:57`, backed by `DEFAULT_ASSET_DRIFT_THRESHOLD`) beside
the plugin's identically-named one (`zintl/src/types.ts:139`), and its own doc comment spends five
lines explaining that the two answer different questions. That explanation is the tell: a preset
needing a paragraph to distinguish its option from the core's has duplicated a core concept under a
local name. The plugin's `similarityThreshold` stays untouched — it governs string reconciliation,
which still compares things.

> The point is not that the preset does less. It is that what it does is **predictable without
> reading it**: a targeted file gets an empty artifact per locale, at a path `outputPattern`
> describes, whatever the format. Configuration selects files and placement — the two things a
> project knows better than the compiler — and never a behaviour, because there is only one.

## 5. What the compiler keeps

Three things, and they are all about the **slot**, never the content.

### 5.1 The slot, scaffolded empty

Localized artifacts live under `outputDir`, beside the catalogs — that is where Zintl's bookkeeping
goes, and an author needs one place to look rather than a rule about which files sit next to their
sources.

Each targeted asset gets an **empty file** at its localized path, for every locale:

```
zintl/src/legal/terms.de.pdf     0 bytes
zintl/src/legal/terms.ar.pdf     0 bytes
zintl/src/media/hero.de.webp     0 bytes
```

Empty, never a copy. This is the same scaffold an unfilled catalog entry is, and it carries the same
meaning without the ambiguity §1 identified: a zero-byte file cannot be mistaken for finished work,
where a byte-identical one is indistinguishable from a deliberate decision. It also tells the author
the exact path and filename to produce, which is the one thing the compiler is in a position to know.

> [!NOTE]
> The symmetry with strings is exact rather than analogous. `verifyIntegrity` already treats
> `translation === ""` as missing; `size === 0` is the same statement about a file. One rule, two
> representations.

**This is measured, not proposed.** The repository already works this way wherever assets are
actually exercised. `rsbuild-vanilla-basic` is the only project claiming the `assets` capability, and
its committed tree is:

```
examples/rsbuild-vanilla-basic/src/about.txt              ← source
examples/rsbuild-vanilla-basic/src/i18n/src/about.ar.txt  ← outputDir, authored Arabic
```

`outputDir` is `./src/i18n` there. The Arabic is hand-written prose, not a merge product, and it sits
under the output directory rather than beside its source. Across the workspace, 152 files under
examples' `outputDir`s are tracked in git: these directories are committed and human-edited already,
so §5.1 asks authors to fill files somewhere they are already working.

That also settles a contradiction §7.1 raises: ZRS §14.1's "beside the source" is not merely
superseded by this proposal, it is **already contradicted by the only app that exercises the
feature.**

### 5.2 Identity, so a rename never costs an artifact

The hive tracks each source asset by content hash and records the localized artifacts belonging to it.
When a source asset **moves or is renamed**, its artifacts move with it.

**It stores identity, never bytes.** Today the hive holds asset _content_: `assets.ts:295–312` writes
localized binaries into it as base64 and reads them back out to rebuild a file. That storage is
deleted. A hive entry becomes a content hash plus the artifact paths belonging to it, which is
everything a move needs and nothing a copy could use — restoring content into an artifact is copying
(§3), whichever direction it comes from.

This is the point of tracking at all. Restructuring a directory must not orphan a German PDF somebody
commissioned, exactly as it must not orphan a translation — identity is content-based everywhere else
in this project, and an asset slot is no different.

| Observed            | Meaning          | Action                                         |
| :------------------ | :--------------- | :--------------------------------------------- |
| Same hash, new path | Moved or renamed | Move the artifacts to follow                   |
| Same path, new hash | Edited in place  | **Nothing** — §3                               |
| New hash, new path  | Ambiguous        | Treat as new; leave the old artifacts in place |

The third row is the one string reconciliation also cannot resolve, and it is answered the same way:
conservatively. Nothing is deleted, so a wrong guess costs an orphaned file a person can move, never
content a person cannot recover.

### 5.3 Resolution — the part that does not exist yet

An import of a targeted asset resolves, for the active locale, to that locale's artifact.

The original draft called this "the whole of what the plugin does for assets, and one rule for every
type", in one sentence. That sentence was the weakest claim in the proposal, and measuring it is what
prompted this revision.

**Measured: binary assets are never resolved at all today.** `getAssetTranslations` skips them
(`assets.ts:628`), and the load path claims only `.md` and `.txt` (`hooks/resolve.ts:374`, `:499`). A
targeted `.pdf` is written to `outputDir` and **nothing ever reads it.** The German legal PDF and the
Tokyo storefront photograph — the images this proposal's §0 is built on — are a dead path in the
current implementation.

So delivery has two modes, and they are not an accident of the derived model:

| Content | Reaches the browser as                                                 | Locale-switchable at runtime because     |
| :------ | :--------------------------------------------------------------------- | :--------------------------------------- |
| Text    | A catalog entry `@zintl/asset:<id>`, inlined into the boundary's chunk | It is a catalog string like any other    |
| Binary  | Nothing today; necessarily a **reference**                             | Would need a locale → URL map at runtime |

Text cannot simply become a reference: its content ships _inside_ the boundary's catalog chunk, which
is what gives it the synchronous boost, chunk association, and the HMR path §7 discusses. Demoting it
to a URL fetch would be a regression, not a unification.

What §5.3 therefore requires, and what does not exist:

1. **Per-locale emission into the bundler's asset graph**, so each artifact gets a real (hashed) URL
   rather than a path under `outputDir`.
2. **A locale → URL map reaching the runtime**, so an import whose locale is a runtime variable
   resolves to the right artifact. This is the genuinely new mechanism.
3. **The baked case, which already has a precedent.** When the anchor took a literal locale, the
   choice is a build-time fact and the import can be rewritten at resolve time — which is exactly
   what the multiplex branch at `hooks/resolve.ts:172–205` already does. The gap is the
   runtime-variable case, not the literal one.

None of this is deletion. It is the one part of this proposal that is a feature, and §9 sequences it
accordingly.

## 6. The gate, concretely

```
[Zintl Integrity Error] 3 unfilled localized assets across 2 locales.

Every targeted asset needs its own artifact per locale. These files exist and are
empty; fill them. Zintl scaffolds them empty rather than copying the source,
because an English PDF at the German path is not a German PDF.

  de — 2 empty
    zintl/src/legal/terms.de.pdf
    zintl/src/media/hero.de.webp

  ar — 1 empty
    zintl/src/legal/terms.ar.pdf

Fix:    fill the files above.
Or:     stop targeting the asset, if it is the same in every locale.
```

The second remedy matters as much as the first: under §2 an untargeted asset is a shared one, so
_"remove it from `assetsTarget`"_ is a correct and complete answer, not a workaround.

### 6.1 What dev does, which is not what the gate does

§10 settles that the gate is on for builds and off while serving. That leaves a question the original
draft did not ask, and §1.2 makes it urgent: **what does the dev server show for a zero-byte
artifact?**

The three fallbacks give three wrong answers on their own. `:204` and `:526` see a file that exists
and serve nothing. `:553` sees a falsy catalog entry and serves English. So a developer switching to
German gets either a blank region or the source text, and no indication which one is a bug.

Neither is acceptable, and "turn the gate on in dev" is the wrong fix — it makes the dev server
refuse to serve a project mid-translation, which is the normal state of one.

**An empty artifact in dev is a loud, attributable failure at the point of use**: the resolved module
throws or renders a visible error naming the file to fill, the same way a missing string is made loud
rather than papered over. This follows the project's own rule — _don't add a fallback path, make the
failure louder_ — and it keeps the build gate (§6) as the thing that decides releases.

A build ships nothing until the gate passes; dev shows exactly which slot is empty and where it
lives. Silence and English are removed at both ends.

## 7. HMR

The current hot path is built on the machinery §4 deletes — the `b_assets` virtual boundary carries
content that came from hives and comparisons. Under this model there is no content to carry, and the
question becomes the simpler one it should always have been: _the artifact for the active locale
changed on disk; invalidate whatever depends on that slot._

This is a rebuild of the asset HMR path rather than an adjustment, and it is the one place this
proposal costs more than it saves. It is also downstream of §5.3: what "depends on that slot" means
differs for a catalog-carried text asset and a URL-referenced binary one, so the HMR rebuild cannot
be specified before delivery is. The two move together, in the same change (§9, step 3).

### 7.1 ZRS §14 describes the model this replaces

`ZRS.md` §14.1 says _"If `about.txt` exists, Zintl looks for `about.[locale].txt`"_ — beside the
source, and derived-model wording throughout §14.2–§14.3. §5.1 puts artifacts under `outputDir`, and
§3 removes the derivation.

ZRS is the normative document, so it moves when this lands, not before. Recording the contradiction
here so that whoever builds this knows §14 is a rewrite and not a reference — and see §5.1, where the
repository's own example already disagrees with §14.1 today.

## 8. What this costs, and what it adds

The original draft's **"A simplification: most of it is deletion"** was wrong, and wrong in the
direction that matters — it made the expensive half invisible. Corrected:

| Part                                     | Character        | Depends on |
| :--------------------------------------- | :--------------- | :--------- |
| §3–§4, removing derivation               | Deletion         | —          |
| §1.1, removing the `continue`            | One line         | §5.1       |
| §5.1, empty scaffolds                    | Small            | —          |
| §1.2 + §6.1, the three fallbacks and dev | Small            | §5.1       |
| §5.2, identity from the hive             | Kept, simplified | —          |
| **§5.3, resolution for binary**          | **New feature**  | —          |
| **§7, the HMR rebuild**                  | **Rebuild**      | §5.3       |

The deletion is real. It is also not the part with the schedule risk.

**Test surface, measured.** `packages/zintl/src/__tests__/compiler/static_assets.test.ts` has 12
tests; about half describe behavior §3 deletes outright — frontmatter merge, outdated-flagging on
source change, fuzzy matching and waterfall review (twice), and custom strategy functions. Two more
(text and binary move recovery from the hive) survive as §5.2 but lose their fuzzy/body basis and
need rewriting.

**The contract layer survives untouched, and that is evidence.** `tests/contracts/assets.contract.spec.ts`
asserts that `en` renders the source asset and `ar` renders the localized one — which is precisely
this model, and it already passes against an authored Arabic file (§5.1). Only
`asset-hmr.contract.spec.ts` is affected, by §7.

A change that deletes half the unit tests while leaving the contract green is a change that removed
mechanism rather than capability. That is the strongest single argument for the model, and it is also
why §9 refuses to let the mechanism deletion wait on the feature.

## 9. Sequencing

This proposal should not land as one change. Bundled, its cheapest correctness fix is held hostage by
its largest unbuilt feature.

**Step 1 — 034 §2 and §5.** `ContentFacet` declares its ownership; the load path stops guessing at
`.md`/`.txt`. Independent of everything here, small, and it makes two content facets claiming one file
a detectable conflict. Nothing in this proposal blocks it or is blocked by it.

**Step 2 — the no-fallback fix, and the deletion with it.** §5.1 empty scaffolds for every type,
remove the `continue` at `index.ts:3140`, fix all three fallbacks in §1.2, add §6.1's dev behaviour —
**and delete what §4 and §4.1 delete**: copying, `AssetMergeStrategy` and its function form,
frontmatter parsing, similarity scoring, `similarityThreshold`, and the hive's content storage.

The deletion belongs here rather than in step 3, and that placement is a decision rather than a
convenience. Copying _is_ the fallback (§1.1), so a change that removes source-locale fallbacks while
leaving the copy behind has not finished the job — it would ship a build gate that passes on a
byte-identical artifact, which is the exact hole this proposal opened by finding. The two are one
change because they are one bug.

This step needs neither §5.3 nor §7 to be correct: text assets already resolve.

**Step 3 — resolution and HMR, as its own proposal.** §5.3 and §7 together, scoped as the feature
they are, carrying the runtime locale → URL map this proposal does not design. §3's prohibition is
what makes that design tractable, so it is inherited rather than re-argued.

**034 §4 is retired rather than sequenced.** An earlier draft kept it live as an interim bug fix:
a custom `strategy` is honoured on one path out of six, and ~30 lines would fix that while the larger
deletion waited in step 3. Moving the deletion into step 2 removes the interval that argument needed.
Fixing a knob in the release that deletes it is churn, and it would leave `strategy` looking
supported for exactly one version.

## 10. Open questions

**What does `assetsTarget` become?** 034 §1.6's conflict is unchanged: it configures a facet the
project can replace, silently. This proposal shrinks the facet enough that the option may be the only
surface worth keeping — but that is 034 §8's decision, not this one's.

**Does the gate default on? — decided 2026-08-25: yes.** On for builds, off while serving, which is
`verifyIntegrity`'s own default and for the same reason: the check costs a pass over every artifact,
and a dev server is not where a release is decided. See §6.1 for what dev does instead of gating,
which is a separate question the original decision did not cover.

It is not a new option. `verifyIntegrity` already governs this question for strings, and
`index.ts:3140` — the line that skips `b_assets` — is the whole of the difference. **Removing that
`continue` is the change**, not adding a `verifyAssets` beside it: an unfilled asset then joins the
same report, under the same option, with the same wording, because §5.1 makes it the same rule.

The break is real and should be stated plainly in the changelog rather than discovered. A project can
have had targeted assets for months without ever filling a variant, because nothing has ever told
them — so the first build after upgrading is where they find out, and the error must be worth reading
when it arrives. §6 is that error, and its second remedy (_stop targeting it_) is the correct answer
for anybody who discovers their asset was never meant to vary by locale.

**With `AssetMergeStrategy` gone, what answers "inline or reference"? — answered 2026-08-26: the
import does.** The strategy doubled as the discriminator (`getAssetTranslations` skipped
`binary-passthrough`), so deleting the enum removed that answer along with the merging it was named
for.

Neither candidate this section proposed was needed. The answer was already written in every localized
import in the repository:

| Import                            | Delivery                                  |
| :-------------------------------- | :---------------------------------------- |
| `import t from "./about.txt?raw"` | **Inline** — content is the catalog value |
| `import u from "./hero.webp"`     | **Reference** — URL is the catalog value  |

That is the bundler's own convention rather than a rule Zintl invented, and it meets §0.1 exactly: no
facet option, no per-format procedure, nothing to configure and nothing that can go stale. Measured
before being relied on — every asset import across `examples/` and the test suite already carries
`?raw`, so nothing depended on the plain-import path meaning something else.

**Does anything currently depend on a targeted binary asset? — answered 2026-08-26: nothing did, and
now something does.** §5.3 measured that nothing resolved one, which is what made step 3 free to
design delivery from scratch. The `assets-authored` fixture now localizes a real `.png` and asserts
the bytes a browser fetches, so the path has a standing consumer rather than only a design.

## 11. What this proposal does not cover

- **Per-locale modules** — a `.tsx` component authored per locale. It shares this proposal's
  _selection_ logic and needs module resolution rather than content resolution, because an imported
  asset resolves to a string (`hooks/resolve.ts:499`) and a component cannot. Its own proposal.
- **Editorial staleness.** Whether the German version has fallen behind the English is a real
  question that §3 removes from the compiler deliberately. It belongs to a person or a TMS.
- **Schema-aware completeness** for adapted data — knowing that a branch table has all its rows, not
  merely that the file exists. Presence is what this gates; correctness is not offered.

## 12. What building it changed

Implemented 2026-08-26. The model needed no revision; four things about the _description_ of it did,
and they are recorded here rather than silently corrected because three of them were confident claims.

### 12.1 "Removing that `continue` is the change" — wrong

§10 said the gate was one deleted line at `index.ts:3140`. Removing it gates nothing.
`internalManifest["b_assets"]` is populated only under `if (this.isDev)`, and `verifyIntegrity` runs
only in a build, so there are no asset keys in the loop that `continue` skips.

The gate is its own pass, through a new `ContentFacet.getUnfilledOutputs` hook: stat every artifact,
report the ones with no bytes. That is also the more honest shape, because a catalog value cannot
answer the question for both delivery modes — a referenced artifact's value is a URL, which is
non-empty however few bytes stand behind it. The **file** is the thing to ask, which is what §5.1
said all along.

Same option, same report, same wording. Just not the same line.

### 12.2 "Binary is never resolved at all" — nearly wrong, and then wrong again

§5.3 said nothing resolves a targeted binary asset. One branch did: under `virtualAssets`, the plugin
emitted the buffer through `this.emitFile` and returned a real `ROLLUP_FILE_URL` — fed from the hive
base64 backups §5.2 deletes.

That path survives, re-pointed at the artifact instead of at the hive, but it is no longer how binary
delivery works. `getChunkContributions` imports the per-locale artifact **plainly**, the bundler emits
and hashes it as it would any asset, and the URL becomes the catalog value. No `emitFile` and no
host-specific code.

> [!CAUTION]
> **"No runtime URL map" was wrong, and a contract caught it.** This section
> concluded that putting URLs in the catalog was the whole of §5.3. It is the
> whole of it _for a build_, where multiplexed resolution rewrites each import to
> one locale's artifact — and nothing at all for a dev server, where the locale
> is a runtime variable.
>
> A plain import is a **static binding**. It resolves once, to one file, and
> nothing re-reads it when the locale changes, so putting the answer in the
> catalog achieves nothing unless something _reads_ the catalog. Measured on the
> `assets-authored` fixture: both locales resolved `#asset-image` to
> `/src/hero.png`, the source, and the `asset-reference` contract sat `pending`
> for a release saying so.
>
> §12.5 records what it took, which is closer to what §5.3 asked for than to what
> this section claimed.

### 12.3 The fallbacks were not three, and one of them was load-bearing

§1.2 listed three. Seven sites fell back to the source locale or skipped silently, and one of them
was hiding a real defect that only surfaced once the fallback was gone:

**Multiplexed resolution rewrites an asset import to one locale's artifact while keeping the
`zintl-multiplex=` marker.** The load path then localized that already-localized path a second time —
asking for `about.ar.ar.txt`, finding nothing, and serving the source. It produced the right text
anyway, because `|| sourceContent` caught the miss and `sourceContent` happened to be that artifact's
own text.

So the runtime proxy in that path had never worked; it had only ever missed, into a fallback that
happened to hold the right answer. Deleting the fallback is what exposed it, which is the argument
for deleting fallbacks stated more sharply than §3 managed: a fallback does not only hide missing
translations, it hides **broken lookups**, and those stay broken until something takes the cushion
away. Four asset scenarios failed the moment it went.

The fix is not to repair the lookup. A module whose identity already names a locale has nothing to
choose at runtime, so it exports the artifact's content directly.

### 12.4 §6.1's dev behaviour is a warning, not an error at point of use

Decided 2026-08-26, against what §6.1 argues. An unfilled artifact in development is served **empty**
with one warning per artifact naming the file to fill, rather than rendering a visible failure where
it is used.

The reasoning §6.1 gives against silence still stands and is worth keeping in view: a warning in a
terminal is closer to the thing §1 exists to remove than a failure a person cannot miss. What carries
the guarantee is the build gate, which is on by default and cannot be scrolled past.

### 12.5 The runtime map, built

An import of a targeted asset now resolves to a module that reads the active locale on **every**
access, for both delivery modes. Inline already worked this way; reference does now, and the two are
the same shape differing only in what the catalog holds — text for one, a bundler URL for the other.

Three things it needed, and two of them are lessons rather than code:

**The facet had to be asked a narrower question.** The first attempt gated on `ownsContent`, which is
true of the HTML projection facet for every `.html` in the project — so the plugin claimed the page
template and Rspack handed it to the JavaScript parser. Ownership says _whose file this is_; it is not
a licence to intercept an import of it. `ContentFacet.deliversUrl` is the question that was actually
being asked, and asking it plainly also states in the type what the two facets do differently.

**The module needed an identity of its own.** Leaving the id as the asset's own path repeated ledger
L-009 — a host that types modules by extension sees `.png` and retypes our JavaScript — and added a
second failure on top: unplugin materialises a virtual module as a real file under
`node_modules/.virtual/`, so a module minted at the asset's path could no longer resolve
`virtual:zintl/runtime/internal` and Rspack reported a missing module three directories from the
cause. `RESOLVED_URL_ASSET_PREFIX` is `RESOLVED_RAW_ASSET_PREFIX`'s counterpart, for the same reasons
and one more.

**The generated module must not be intercepted by the thing that generated it.** The catalog reaches
each locale's artifact by importing it, and those imports would themselves be rewritten — a module
importing itself. They carry `?zintl-url`, which the plugin declines, exactly as `?zintl-raw` marks
the inline side. A query is how an importer says which of two things it wants, and both spellings now
have one.

The source locale is answered by a direct import rather than through the catalog: its artifact _is_
the source file, so there is nothing to look up, and in ghost mode there is no catalog on disk to look
it up in.

### 12.6 The dev cache-busting caveat, withdrawn

§12.5 shipped with a caveat attached: that re-authoring an artifact in dev would not change its URL,
so a browser might hold the old bytes until a reload. That was reasoning, not measurement, and it is
wrong.

`asset-refresh` measures it — writing new bytes to an artifact and fetching what the asset's URL
serves, through the browser's ordinary cache rather than around it. Both directions pass: the
translator's edit to `hero.ar.png`, and the developer's edit to the source, whose URL is resolved by a
direct import rather than through the catalog.

Two things about the contract are worth keeping in view, because both were nearly got wrong:

**The cache mode is the measurement.** The first version fetched with `cache: "no-store"`, which
bypasses the HTTP cache — so it reported what the _server_ would send rather than what a page
receives, and a stale-cache failure was invisible to it by construction. It passed, and proved
nothing. Default semantics are what an `<img>` gets, so they are what the contract must use.

**It does not assert that no reload happened.** A vanilla entry declines hot updates and lets them
bubble (L-035), so a reload is correct behaviour here and forbidding it would fail a project for being
right. The guarantee is that the browser ends up with the new bytes, by whichever route it gets there.

Verified falsifiable before being believed: suppressing the write turns it red with the message it
was written to produce.
