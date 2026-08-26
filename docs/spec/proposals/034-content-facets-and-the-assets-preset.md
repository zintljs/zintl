# Proposal 034: Content Facets and the Assets Preset

**Status**: SUPERSEDED IN PART — the audit (§1) and the `ContentFacet` finding (§2) stand and are the
basis for [035](035-localized-assets-are-authored.md). §3 and §4 are **retired outright** as of
2026-08-26: 035 deletes `AssetMergeStrategy` rather than declaring it, so there is no table to turn
into data and no strategy left to resolve once. §7 (sibling-exclusion) has nothing left to act on.
§2 and §5 are **built**: `ContentFacet` declares `extensions` and conflicts between content facets
are caught at construction, and every host site that tested `.md`/`.txt` by hand now asks the facet
layer — §5 turned out to be nine sites rather than the two this audit found. §8 is **settled** as
option 3: both spellings stay, and configuring a facet the project then replaced is a hard error.
**§6 alone remains open**, and it is the whole of what is left here — nothing yet refuses an asset
target whose output would collide with the catalog namespace, so `assetsTarget: ["json"]` still
builds silently. Narrower than this audit first claimed (see §1.4's correction), and still unguarded.
**Corrections (2026-08-26)**: §1.3 and §1.4 were narrowed after re-measurement and carry a note in
place; §1.1 was undercounted and carries one too. Every other line cited in §1 was re-verified
against the same file and holds unchanged.
**Date**: 2026-08-25
**Kind**: Audit and design. Every finding in §1 was produced by running the code or reading the line
cited, never by inference.
**Depends on**: the assets preset (`packages/compiler/src/facet/presets/assets.ts`), `ContentFacet`
(`packages/compiler/src/types/capabilities.ts`), and the plugin's resolve hooks
(`packages/zintl/src/hooks/resolve.ts`).
**Related**: [033](033-structural-defaults-and-declared-targets.md) settled the same question for
_extraction_ targets. This is the content side, and the answers rhyme.

## 0. The thesis

Zintl's content pipeline was written when `.md` and `.txt` were the only content there was, and the
shape of that assumption is still load-bearing in six places. The result is a facet that **is**
general — `AssetMergeStrategy` already accepts a function, `AssetTargetConfig` already takes a
`strategy` — wrapped in a preset that keeps deciding things from the file extension anyway.

The fix is not to make the assets facet do more. It is to make it **declare** what it currently
hardcodes, so a project can say _"treat `.rst` the way you treat `.txt`"_ once, and so the facet type
underneath gets more useful for everyone writing their own.

> [!NOTE]
> **Superseded 2026-08-26, and worth reading as a wrong turn.** Declaring the table is the right fix
> _if the procedures have to exist_. They do not: [035](035-localized-assets-are-authored.md) §3
> stops content crossing from a source to a localized artifact, and every entry in the table
> described how to make that crossing. So `.rst` is not treated like `.txt`; nothing is treated any
> way at all.
>
> The half of this thesis that survives is the second one. `ContentFacet` really should declare its
> ownership rather than only answer about it (§2), and that finding is independent of whether the
> assets preset has a strategy table — which is why §2 outlived §3.

## 1. The audit

### 1.1 The strategy is resolved once and re-derived five times

`resolveAssetConfig(filePath)` returns `{ strategy, … }` (`assets.ts:121`) and the write path uses it
(`assets.ts:209`, `:221`). Five other sites ask the **extension** instead:

| Line            | Decides                                      |
| :-------------- | :------------------------------------------- |
| `assets.ts:166` | strategy inference — the table itself        |
| `assets.ts:363` | keep existing frontmatter when reconciling   |
| `assets.ts:381` | build the "please re-translate" warning body |
| `assets.ts:412` | restore frontmatter from the hive            |
| `assets.ts:504` | `getAssetBody` — strip frontmatter or not    |
| `assets.ts:685` | heal a body from the hive                    |

Every one of those is spelled `ext === ".md" || ext === ".mdx"`.

> [!IMPORTANT]
> **Undercounted, found 2026-08-26 by building a fixture that targets `.rst`.**
> Six is the count _inside the assets preset_. Three more sites re-derive the
> same fact from the same two extensions, in files this audit never opened:
>
> | Site                              | Decides                                             | Consequence for a non-default target                                                                                        |
> | :-------------------------------- | :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
> | `pipeline/intent-core.ts:113`     | whether a boundary has translations worth a manager | **No manager is generated at all.** The page renders a pseudo-localized key and the console says only "no manager provided" |
> | `hmr/plan.ts:32` (`classifyFile`) | what kind of change a watched file is               | An artifact edit is classified as no kind of change; no hot update runs                                                     |
> | `managers/CatalogManager.ts:1380` | which files under `outputDir` may be reclaimed      | Orphaned artifacts outlive their source indefinitely                                                                        |
>
> The first is the one that matters, and it is worse than anything in the table
> above: the others honour the option on the wrong path, and this one skips the
> feature entirely. It also explains why the audit missed all three — it searched
> the preset and the plugin's resolve hooks, which is where an _asset_ concern
> would sensibly live, and the extension test had leaked two layers past both.
>
> Nine sites, then, and the honest generalisation is §2's rather than this
> section's: the problem was never how many places re-derive the strategy, but
> that a **predicate nobody can enumerate** invites every caller to guess.

**The consequence is a live bug, not untidiness.** A project writing

```ts
assetsTarget: [{ targetPattern: "**/*.rst", strategy: "frontmatter" }];
```

gets frontmatter handling when the file is **written** and plain-text handling everywhere it is
**reconciled, warned about, or healed** — because those five sites never learn what the strategy
resolved to. The option is honoured on one path out of six.

### 1.2 The inference table is code, not data

`assets.ts:166` is the only place that says `.md`/`.mdx` → `frontmatter`, `.txt` →
`text-passthrough`, everything else → `binary-passthrough`. A project can override per _target
pattern_, and cannot state the mapping once — so "treat `.rst` like `.txt`" must be repeated on every
target that could match one, and cannot be stated at all for a pattern that matches several
extensions.

This is the concrete form of _"a special procedure for a group of file types should be an option"_.

### 1.3 The plugin hardcodes the extensions the facet is supposed to own — in one hook, not in all

`hooks/resolve.ts:374`, `:499` and `:502` test `cleanId.endsWith(".md") || cleanId.endsWith(".txt")`.

`AssetManager.isSupportedAsset()` exists (`assets.ts:441`), is config-driven, and is already exposed
as the facet's `match` (`assets.ts:775`).

> [!NOTE]
> **Corrected 2026-08-26.** This section first said "The plugin does not ask it." That is wrong, and
> the correction narrows the finding without dissolving it.
>
> The plugin **does** ask, at `hooks/resolve.ts:144`, `:172` and `:285` — which is the whole of the
> `resolveId` path. The extension literals survive only in the **load** path (`:374`, `:499`,
> `:502`).
>
> So this is not a host ignoring a facet's declaration. It is the plugin **disagreeing with itself
> across two hooks**: a configured `.rst` is recognised and registered when its import is resolved,
> and then unknown when the module is loaded, so it never reaches the substitution the registration
> was for. Smaller to fix than the original wording implies, and harder to defend — the same file
> already knows how to ask.

That is still the layering fault 033 §1.2 found on the extraction side, one hook over: something
guessing at what a facet had already declared.

### 1.4 Asset output paths are derived from catalog paths

`getAssetPath` calls `catalog.getCatalogPath(id, locale)` and then rewrites the result — including a
literal `.json` branch (`assets.ts:490`) that string-surgeries the extension.

So assets and catalogs share one namespace — and `.json` is not merely an awkward asset type but a
structurally dangerous one, because a catalog _is_ a `.json` file produced by the same path-building
function. Measured: building with `assetsTarget: ["json"]` succeeds silently and writes
`zintl/src/doc.ar.json` next to `zintl/index.html.ar.json`, one of which is a catalog.

> [!NOTE]
> **Corrected 2026-08-26.** This section first said the namespaces are shared "by construction". They
> are shared **conditionally**, and the condition matters for how much has to change.
>
> `getAssetPath` has an earlier branch (`assets.ts:479–486`) that writes straight under `outputDir`
> whenever `catalogFormat` is absent or is multilingual — which is the default, and therefore the
> path most projects are on. `getCatalogPath` and the `.json` string-surgery are reached only when a
> per-locale `catalogFormat` is configured.
>
> The collision is real and still worth refusing, but it is a bug on one branch rather than a
> property of the design. §6's smallest option is correspondingly smaller: guard the branch that
> collides, and leave the default branch alone.

### 1.5 Already-localized siblings are localized again

Measured, with `assetsTarget: ["md"]` and a `src/doc.ar.md` translation present:

```
zintl/src/doc.ar.md        ← the localized copy of doc.md
zintl/src/doc.ar.ar.md     ← the localized copy of doc.ar.md
```

`**/*.md` matches the translation as if it were a source. `ContentFacet.isLocalizedOutput` exists for
exactly this and the preset implements it (`assets.ts:791`), but it identifies files this facet
_emitted_, not sibling translations living in the source tree — which is where ZRS §14.1 says they
live.

### 1.6 `assetsTarget` is discarded when a project supplies its own assets facet

The last of the option/facet duplicates `docs/stability.md` flags. Measured:

```ts
zintl({
  assetsTarget: ["rst"], // configures the built-in facet
  facets: ["builtins", assetsFacet({ targets: ["adoc"] })], // replaces that facet
});
```

Exactly one `system-static-assets` facet survives. Under 033 §4's provenance rule the project's own
facet wins — correctly — and `assetsTarget` goes with the facet it was configuring, **silently**.

Neither option is wrong on its own. The conflict is that one configures a thing the other can delete.

## 2. What the audit says about `ContentFacet` itself

§1.3 is the interesting one, because it is not an assets problem.

`ContentFacet.match` is a **function**. A host can ask _"do you own this file?"_ one path at a time,
and can never ask _"which files do you own?"_ — so any host that needs the set in advance, as
`resolveId` does, has to guess. It guessed `.md` and `.txt`.

Compare `CodegenFacet`, which declares `extensions: string[]` and is therefore enumerable — which is
exactly why two codegen facets claiming `.tsx` is a hard error at construction and two content facets
claiming the same file is not detectable at all.

**This is the generalizable finding: a content facet should declare its ownership, not only answer
about it.** `match` stays for the cases only a predicate can express; a declared pattern list is what
lets the host stop guessing and lets conflicts be caught.

## 3. Proposal: declare the strategy table

> [!CAUTION]
> **Retired 2026-08-26.** 035 deletes `AssetMergeStrategy` outright — including its function form,
> `(source, existing, locale) => Buffer`, which is content crossing the boundary by definition. A
> strategy decides how to build a localized copy _from a source_, and nothing is built from a source
> any more: every localized artifact is scaffolded empty and authored.
>
> There is therefore no table to turn into data. This section's goal — a project stating _"treat
> `.rst` the way you treat `.txt`"_ once instead of per target — is met by removing the question
> rather than by answering it: no extension is treated any way at all.
>
> One question does survive the deletion, and it is **not** a merge strategy: whether an artifact's
> bytes reach the browser inlined in a catalog chunk or by reference. That is a delivery mode, it is
> owned by 035 §5.3, and it does not belong in this preset's config.

```ts
assetsFacet({
  strategies: {
    md: "frontmatter",
    mdx: "frontmatter",
    txt: "text-passthrough",
  },
  defaultStrategy: "binary-passthrough",
});
```

Those values are the current behaviour, moved from code into a default a project can read and
replace. Adding `rst: "text-passthrough"` then means _"treat `.rst` the way you treat `.txt`"_,
everywhere, once — including the five sites of §1.1.

Per-target `strategy` keeps its meaning and wins over the table, because it is more specific.

The docs gain something they cannot have today: a table stating **why** `.md` is handled differently
from `.png`, in the same place a project would change it.

## 4. Proposal: resolve the strategy once

> [!CAUTION]
> **Retired 2026-08-26.** With §3 retired there is no strategy to resolve, and §1.1's five
> re-derivations are deleted along with the sites that perform them.
>
> This section was briefly kept alive on the argument that a custom `strategy` is honoured on one
> path out of six today, so ~30 lines of fix were worth having while the larger deletion waited.
> That argument no longer holds: the deletion no longer waits. Removing copying is part of the same
> change that removes the source-locale fallbacks (035 §9, step 2), rather than of the later
> resolution work, so there is no interval during which an interim fix would be the shipping
> behaviour.
>
> Fixing a knob in the same release that deletes it is churn, and it would leave a `strategy` option
> looking supported for exactly one version.

Delete the five re-derivations of §1.1. Every site that needs to know how a file is handled asks the
resolved config, which already carries it.

Two of them (`:363`, `:412`, `:685`) do not want the strategy but a narrower fact — _does this format
carry frontmatter?_ That is a property **of the strategy**, not of the extension, and should be asked
of the strategy.

## 5. Proposal: the host asks the facet

`hooks/resolve.ts:374` and `:499` call the facet, through the enumeration §2 proposes or through
`isSupportedAsset`. No extension literal survives in the plugin for content it does not own.

## 6. Proposal: separate the asset and catalog namespaces

§1.4 is the one finding whose fix is not obvious, and the options differ in cost:

| Option                                                                | Cost    | Leaves                     |
| :-------------------------------------------------------------------- | :------ | :------------------------- |
| Refuse a target whose output would collide with the catalog namespace | Small   | The coupling, with a guard |
| Give assets their own path builder, not `getCatalogPath`              | Medium  | Nothing shared             |
| Refuse `.json` targets specifically                                   | Trivial | Every other collision      |

The middle option is the honest one — assets are not catalogs and should not be named by the
catalog's rules — but the smallest defensible step is the first, because a _silent_ collision between
a user's asset and a translation catalog is the worst outcome available and the guard removes it
outright.

## 7. Proposal: stop localizing translations

Exclude a file from the source set when it already matches the localized-output pattern for any
active locale. `isLocalizedOutput` is the right hook and needs to consider sibling translations, not
only emitted files.

## 8. Proposal: settle `assetsTarget`

> [!NOTE]
> **Settled 2026-08-26: option 3, as a hard error.** Both spellings stay; the
> interaction is refused rather than resolved.
>
> What decided it is that (1) and (2) answer a question nobody asked. Two
> spellings were never the harm — `docs/stability.md` had already documented
> which one wins, and the semantics were not in doubt. The harm was that the
> _runtime_ did not agree with the documentation, so a project could be told
> nothing while its assets went unlocalized.
>
> An error rather than a warning, because the consequence is **wrong output**
> rather than a surprising configuration, and because there is genuinely nothing
> to fall back to: an option cannot be forwarded into a facet the project
> constructed itself, so "honour both" was never on the table.
>
> Implemented in `facets/assemble.ts`, where `flattenFacets` already returned the
> `overridden` set that makes it detectable. `virtualAssets` counts only when
> `true` — it is resolved against a default before assembly, so `false` cannot be
> told apart from unset, and `false` is the facet's own default anyway.

Options, and 033 §9.2 sets the precedent that the distinction to preserve is **replace versus add**:

1. **Keep `assetsTarget`, remove `targets` from the public facet options.** One spelling; the facet
   is configured through the plugin. Loses the ability to replace the preset wholesale.
2. **Deprecate `assetsTarget` in favour of `assetsFacet({ targets })`.** One spelling, and the more
   powerful one — but it makes the common case verbose, and the common case is most of the users.
3. **Keep both and make the interaction loud.** A project that both sets `assetsTarget` and supplies
   its own assets facet gets an error naming the conflict rather than silence.

(3) is the smallest change and removes the actual harm, which is silence. (1) is the cleanest surface
and the biggest break. This is a product decision, not a technical one.

## 9. Open questions

**Should `.json` be supported as an asset at all?** §6 can make it safe; whether it should be
_offered_ is separate. A localized `.json` is a plausible thing to want (a data file with prose in
it), and it is also the one extension guaranteed to collide with the catalog namespace.

**Is `binary-passthrough` the right default for an unknown extension? — answered 2026-08-26: the
question is void.** It asked which flavour of copying an unknown extension should get, and there is
no copying. A project adding `assetsTarget: ["rst"]` gets empty artifacts to fill, exactly as it
would for `.md`, `.pdf` or anything else — which is 033 §0's rule (never do something the user did
not ask for) satisfied by doing nothing rather than by choosing a better default.

**Does `ContentFacet` gain a declared pattern list (§2), or does `match` stay the only answer?** The
declared list is what lets the host stop guessing and lets two content facets claiming one file be a
detectable conflict rather than a silent race.

## 10. What this proposal does not cover

- HTML projection (`$H`), which is a content path with its own rules in ZRS §13.
- The `virtualAssets` option, whose behaviour is unaffected by any of the above.
- Whether the assets preset should be split into per-format presets. Possible after §3, and a
  different question from whether the table is data.
