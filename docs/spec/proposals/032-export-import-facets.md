# Proposal 032: Export/Import Facets — the TMS Seam

**Status**: BUILT — every sequenced step (§7 1–4) is implemented, and both blocking decisions are
taken: §8.1 (`context` is metadata, not a key, 2026-08-24) and §8.2 (only `approved` imports,
2026-08-28). Step 5 is _vendor_ facets, which this document deliberately never committed to and which
the seam exists to make somebody else's job. **§7.2–§7.4 record what building steps 2–4 changed**,
including three gaps of the same family as §7.1's — all found the same way, one a rendering bug rather
than the metadata gap it looked like, and one an import that updated memory and never touched disk.
The one loose thread is §1's corollary; see §10.
**Date**: 2026-08-24, steps 1–4 built 2026-08-27/29
**Kind**: Architecture proposal. Names a seam and argues for what belongs on each side of it.
**Depends on**: the faceted architecture (CLAUDE.md), the translation hive
(`packages/compiler/src/managers/MessageManager.ts`), reconciliation
(`packages/compiler/src/reconcile.ts`), and the extractor's per-sink metadata
(`packages/extractor/src/types.ts`).
**Related**: [031](031-pending-locales.md) — a pending locale is exactly the state a TMS is working
through.

## 0. The framing that already exists, and is correct

The sketch this proposal formalises puts the **hive at the centre and the TMS at the edge**:

```
        Translation Hive  ──materialize──►  Catalog  ──export──►  TMS
        (source of truth)                                          │
              ▲                                                 import
              └──────────────── reconcile ◄───── Catalog ◄────────┘
```

That direction is not a preference. It is forced, and the reason is worth stating because a TMS vendor
will push back on it: **a TMS cannot know what a boundary is.** Boundary identity is content-derived
and computed by the compiler from the import graph. Making the TMS authoritative would require giving
it stable, externally-owned keys — which means abandoning content-based identity, which is the
product.

So Zintl is not "integrating with a TMS". It is **lending strings to one and taking them back**.
Everything below follows from that.

## 1. The collision the sketch hides

The arrow marked `reconcile` is where two translation memories meet.

`packages/compiler/src/reconcile.ts` calls the hive a translation memory in its own header, and it is
one: append-only, keyed by source text, globally scoped. Every TMS also has a TM, with its own fuzzy
matching at its own threshold. Edit a source string and **both will try to carry the translation
forward**, independently, possibly to different answers.

This is not a tie to be broken later. `reconcile.ts` is explicit that the two failure modes are not
symmetric:

> A **missed rename** is cushioned … A **wrong rename** is not cushioned. The old translation is
> written into the catalog under the new source text and then memorized into the hive, so a single bad
> match propagates.

Two TMs guessing independently is a wrong-rename generator, and it would be miserable to debug because
neither side is malfunctioning.

**Rule: Zintl reconciles first, and the export states the answer.** A carry-forward is exported
pre-filled and flagged as a suggestion, so the TMS's TM never gets a turn. `ReconcileResult.renamed`
already exists for exactly this — it is documented as the field "callers are expected to surface
rather than apply silently", and an export is the most useful surface it will ever have.

**Corollary:** any TMS whose fuzzy matching cannot be disabled per-import is a target we should
document as degraded rather than support quietly.

## 2. The context leak, which is where the value is

The materialize step in the sketch produces a "simple catalog" — `{ source: "" }`. In the repo that is
exactly right: the source string is the key, and the code is a click away.

For a TMS it is close to worthless. The translator has no code, no screen, and no way to know whether
_Open_ is a verb or an adjective. Missing context is the single most expensive recurring cost in
localization, and every TMS answers it with a hand-written `context` field that is stale the day after
it is written.

**Zintl already computes this and currently throws it away.** `ExtractedMessage`
(`packages/extractor/src/types.ts`) carries, per message:

| Field        | What it carries                                                           |
| :----------- | :------------------------------------------------------------------------ |
| `contexts`   | `"title"`, `"alt"`, `"aria-label"`, `"button"`, `"div"`, `"meta.desc"`, … |
| `note`       | The `@zintl-note` directive — a translator note, already authored         |
| `variables`  | Interpolated bindings **with their source expressions** (on `RawSink`)    |
| `passVars`   | `@zintl-pass` context variables for target-language asymmetry             |
| `tagMap`     | Which alias corresponds to which real tag                                 |
| `isFragment` | Whether this is part of a larger stitched sentence                        |

**`contexts`, not `sinkTypes` — the distinction matters and an earlier draft of this document got it
wrong.** Both are `string[]` on the same message, accumulated at
`packages/extractor/src/context.ts:510-511`, and they answer different questions:

- `contexts` is human-facing: `alt`, `button`, `meta.desc`.
- `sinkTypes` is replacement mechanics: `html:attr:alt`, `HTML_TEXT` — how to splice the call back
  into source.

A translator needs `alt`. `html:attr:alt` tells them nothing they can act on.

The extractor half is **already done and already tested** —
`packages/extractor/src/__tests__/parser.context.test.ts` asserts that a string reached through both
`title` and `alt` gets one id with both contexts recorded. The gap is a single hop: `contexts`
(populated, plural) does not reach the compiler at all — it works from `ObservedSink.sinkType`
instead, which is where the value now comes from. See §7.1, which corrects this section.

That field's comment used to read _"Translator-facing disambiguation context"_ — a description of
something the code does not do, and the reason §8.1 had to be settled before step 1 could mean
anything. It now states what the field is for and what it deliberately is not.

### 2.1 Populating it is inert today, which is the point

Verified rather than assumed, because "add a field to the manifest" sounds like it should perturb
identity and does not:

| Could it disturb… | No, because                                                                 |
| :---------------- | :-------------------------------------------------------------------------- |
| Message identity  | `generateMessageId(text, _context, _note)` — both extra params are unused   |
| Boundary hashes   | The single assignment is `"b_" + sha1(bId)`; no message content is involved |
| Catalog files     | Catalogs are flat `{ "source": "translation" }`; there is no slot for it    |

So the wiring is a **fix with no symptom** — it stops a documented field from lying and changes no
output. Making the value _visible_ (in catalogs, in the schema, in an export) is the feature, and it
is the part that changes a file in every user's repo. They should not be conflated; §8.1 records
what the field means, which is what makes the first half safe to do at all.

## 3. What would make this remarkable rather than adequate

Everything in §2 is context a TMS _asks a human to type_. The boundary graph knows things no TMS can
compute at all:

- **Which screens a string appears on** — boundary → chunk → entry. "This appears on Checkout."
- **That it is shared across four boundaries** — so: _editing this translation changes four screens._
  Translators are never told this, and it is the difference between a safe edit and a regression.
- **Whether it is an `aria-label` or an `h1`** — different registers, different length budgets.
  _True as of step 2, and it was not when this line was written; see §7.2.1._
- **What expression produced `{input}`** — `{input}` alone is unanswerable; `user.firstName` is not.
  _True for every shape as of step 2, and it was not; see §7.2.2._
- **The full stitched sentence a fragment belongs to** — the fragment problem, solved upstream already.

None of this is new machinery. It is a read off the graph that already exists, and because it is
**derived**, it cannot go stale. That is the actual pitch: not "Zintl exports to Crowdin", but _Zintl
tells translators things their TMS has never been able to tell them._

## 4. Import is a gate, not a merge

A translation coming back from a TMS can be wrong in ways the compiler can **check**:

| Corruption                                        | Detectable from                |
| :------------------------------------------------ | :----------------------------- |
| A dropped or renamed `{count}`                    | The manifest's variable set    |
| A mangled `<t0>` alias                            | `tagMap`                       |
| ICU plural categories wrong for the target locale | The locale's CLDR plural rules |
| A translation for a key that no longer exists     | The manifest                   |

Today there is **no validation of catalog values at all** — grep `CatalogManager` for placeholder or
ICU checking and there is none. That is defensible while catalogs are hand-edited next to the code.
It stops being defensible the moment they round-trip through a system that hands translators raw ICU
syntax, which is most of them, and which corrupts it constantly.

So: **a broken import fails the build as loudly as a missing translation.** Same instinct as
`verifyIntegrity`, same batched report shape, and as far as we know no other tool does it.

## 5. Why this is a facet, not core

By the project's own rule — _frameworks and build tools are facets_ — export and import are a
**concern**, and TMS support should be additive:

```ts
zintl({ facets: ["builtins", xliffFacet({ outDir: "./l10n" })] });
```

The compiler must not learn what Crowdin is, exactly as it never learned what Rspack is. What it
contributes to the facet is the _material_: manifest entries, derived context (§3), reconciliation
results, and the validation hooks (§4). What a facet contributes is serialization and transport.

This also means the first target can be a file format rather than a vendor, and a vendor facet can be
written by someone who is not us — which is the same shape as the bundler-facet fence added in the
beta-prep work.

## 6. The format tension — resolved as predicted

§2 and §3 mean the interchange **cannot** be `{ source: "" }` — that shape has nowhere to put context.

| Format         | For                                                             | Against                                                          |
| :------------- | :-------------------------------------------------------------- | :--------------------------------------------------------------- |
| JSON key/value | Hand-editable; already what catalogs are; zero new concepts     | Carries no context, no state, no notes — the whole §3 value lost |
| **XLIFF 2.0**  | `<unit id>`, `<notes>`, `<segment state>`; every TMS ingests it | Heavy; XML; not something anyone hand-edits                      |

Answer, and it is what shipped: **both, at different layers.** JSON stays the repo format and the thing a human
edits; XLIFF is what the export facet emits and the import facet consumes. The repo never gains an XML
file unless someone asks for one. This keeps the "plain JSON you can open" property that people will
like, while giving the TMS seam a format that can carry §3.

## 7. Sequencing

Each step is independently useful, which is the test of whether the decomposition is right.

1. ~~**Populate `ManifestEntry.context`**~~ — **done**, and it corrected this document twice on the
   way. See §7.1.
2. ~~**Derive the graph context of §3** behind one method, e.g. `getMessageContext(boundaryId, key)`.
   Pure read, testable without any TMS.~~ — **done**. `deriveMessageContext` in
   `packages/compiler/src/message-context.ts`, with `ZintlCompiler.getMessageContext` wiring the
   graphs in. See §7.2.
3. ~~**Export facet**, format-first (XLIFF), with §1's pre-filled carry-forwards.~~ — **done**.
   `xliffFacet` in `packages/compiler/src/facet/presets/xliff.ts`, on a new `exchange` facet concern.
   See §7.3.
4. ~~**Import facet with validation** (§4) before any merge is attempted. The gate lands before the
   convenience, deliberately.~~ — **done**. `packages/compiler/src/import-gate.ts` plus
   `xliffFacet.import`. See §7.4.
5. **Vendor facets**, if ever. Possibly by other people.

### 7.1 Step 1, as built — and two things this document had wrong

`ManifestEntry.context` is populated. `note` turned out to be populated already, at the same site.

**This document said the source was `ExtractedMessage.contexts`. It is not reachable.** The compiler
never sees `ExtractedMessage`; it works from `ObservedSink`, which carries a singular `sinkType` and
no `contexts` array. The aggregation the extractor does — pushing each new context onto a per-message
list — happens on the far side of a boundary the compiler does not cross. So §2's correction (from
`sinkTypes` to `contexts`) was right about _which concept_ and wrong about _which object_.

What is available is `sinkType`, written for two audiences at once: `button` and `div` from JSX,
already human; `html:attr:alt` from HTML, naming the attribute and the splice mechanism together. A
`translatorContext()` normaliser drops the transport prefix and turns `HTML_TEXT` into `text`.

**Context is recorded per sink, not unioned per message.** One string reached from an `alt` and a
`title` produces two manifest entries carrying one context each — and, importantly, **one id**, which
is §8.1's safety property observed rather than assumed:

```
"Open"   ctx=alt     id=cf9b7706
"Open"   ctx=title   id=cf9b7706
```

Unioning would mean collapsing entries, which changes how many entries `generateSchema` and
`verifyIntegrity` walk. An exporter that wants the union should take it.

**A gap this document assumes away.** §3 promises the export can say "this is an `aria-label`, not an
`h1`". True for JSX and for attributes; **not** for HTML text, where every element collapses to
`HTML_TEXT` upstream, so an `<h1>` and a `<p>` are indistinguishable by the time the compiler sees
them. Closing it is extractor work. It is asserted as a known gap in
`packages/zintl/src/__tests__/compiler/manifest_context.test.ts` so it stays visible.

**Still inert, as predicted.** Schema generation reads `note` and `variables` and not `context`; the
manifest lives in `metadataDir` (a build artifact); reconciliation never reads the field. No user-
visible output changed, which is why it landed with tests asserting the manifest directly rather than
any behaviour.

### 7.2 Step 2, as built — and a second gap of the same shape

`deriveMessageContext(boundaryId, key, world)` in `packages/compiler/src/message-context.ts`, with
`ZintlCompiler.getMessageContext` wiring the graphs in. Pure module, in the same shape as
`reconcile.ts`, so the structurally interesting cases — an entry that reaches one boundary and not
another, one string in four places — are stated directly against hand-built graphs rather than coaxed
out of real source.

Everything §3 promises is there and derived: `sharedWith` (every other boundary carrying the string),
`screens` (the entries that reach this one), `chunk`, and per-occurrence `context`, `note`,
`variables`, `passVars`, `tagMap`, `isFragment`. Occurrences stay **per sink**, matching step 1 —
the union is available to a consumer that wants it and is not taken on their behalf.

Three things worth carrying forward.

#### 7.2.1 §3's `aria-label`-vs-`h1` claim is now true, and it was not

§7.1 recorded this as a known gap: every HTML text node reached the compiler as one `sinkType`, so an
`<h1>` and a `<p>` were the same thing by the time anyone could show them to a translator. §3 was
written as though it were closed. It is closed now — `stitchHTML` tracks the open block elements and
reports the enclosing one — but the claim was false for every MPA and every vanilla app for the whole
life of this document, and it stopped being false because someone went and looked.

The fix is on `context`, never on `sinkType`, which is the line §2 already draws: `sinkType` is how
the pipeline splices a call back into the document and is compared for equality against `"HTML_TEXT"`
in three places, so widening it would have been a rewrite of the splice path wearing a metadata
change's clothes.

#### 7.2.2 The same gap existed for template literals, and was not a metadata gap

`{input}` alone is unanswerable; `user.firstName` is not — §3's fourth bullet. It held for a JSX
expression container and failed for a template literal, in both the child and attribute positions.

The cause was **three copies of one derivation**. `${user.firstName}` becomes `{user_firstName}` in
the extracted text, and three places decided that independently: the template branch of
`findLiteralsInExpression`, which names the placeholder; `bindings.ts`, which pairs a name back to its
expression for DOM sinks; and `jsx.ts`, which did the same for JSX. Two agreed. The JSX copy handled
only `Identifier`, so a member expression was `var0` there and `user_firstName` everywhere else.

Bindings are matched to placeholders **by name**, which is what made the failure silent: a mismatched
name does not produce a wrong binding, it produces none.

**And it was not only metadata.** The same `variables` array is what `resolve-rewrites.ts` reads to
build the replacement call, so the emitted code was:

```js
_t("Welcome back, {user_firstName}!", { _mgr, _bId }); // before
_t("Welcome back, {user_firstName}!", { user_firstName: user.firstName }, { _mgr, _bId }); // after
```

No params object, and nothing bound to the placeholder. The built page renders `Welcome back,
undefined!` — the baked source locale resolves it through `params["user_firstName"]` — which is a
measurement rather than a reading: `tests/fixtures/jsx-template.ts` renders exactly that with the fix
reverted. A translator-context question found a rendering bug, which is the second time in this
document that going to look was worth more than the thing being looked for.

Now one copy, in `packages/extractor/src/variables.ts`, used by all three sites.

**Why nothing caught it, and what now does.** No project in the manifest used a template literal
inside JSX. `examples/vanilla-ssr/src/counter.ts` uses one on a DOM assignment — the route that was
already correct — and every JSX project writes plain JSX children, so the suite had two well-covered
halves of one feature and nothing across the join. It ran 383 tests with no snapshot diff either
before or after the fix.

Closed on both levels. `packages/zintl/src/__tests__/compiler/template_interpolation.test.ts` asserts
the emitted call rather than the manifest, because the emitted call is what a user runs; and
`tests/fixtures/jsx-template.ts` puts the shape in a real browser through `spa` and `build`. The
fixture was confirmed to fail with the fix reverted — `Welcome back, undefined!` in the rendered DOM
and a `dist-output` mismatch — which is what makes it a guard rather than a description.

#### 7.2.3 What it deliberately does not do

No bulk variant. `sharedWith` scans the manifest, so calling it per message is quadratic, and the fix
is obvious — build the index once. It is not built, because nothing iterates yet: an exported entry
point with no caller is how 034 §2 found a hook that was both dead and wrong. It lands with step 3.

No `CompilerContext` field either, for the same reason. The seam §5 describes is real and the facet
that consumes it does not exist; the hop lands when it does.

### 7.3 Step 3, as built

`xliffFacet` on a new **`exchange`** facet concern — `export(bundle, context)`, one call per locale,
production builds only. The compiler assembles an `ExportBundle` and knows nothing about XLIFF;
`ContentFacet` was the tempting reuse and is a category error, since it requires `match` because it
exists to own a _file type_ and contribute translations, and an export facet does neither. The
concern also leaves a named place for step 4's import hook.

**Exported before `verifyIntegrity`, not after.** The build most in need of an export is the one
about to fail for missing translations; running after the gate would mean the export never happens
exactly when it is wanted.

**Notes, not `<mda:metadata>`.** Every TMS renders notes to the person doing the work; the metadata
module is usually invisible in a translator UI. A derived fact nobody sees is a fact that did not
travel, and §3's whole argument is that these facts should reach a human.

**Maintained locales, not shipped ones.** A pending locale ([031](031-pending-locales.md)) is
exported. §9 said the two designs would meet and this is where: a locale being stood up over weeks is
the single most likely reason to be handing strings to translators at all.

#### 7.3.1 The first shape was wrong, and reading the output is what caught it

The obvious grouping is `<file>` per boundary, mirroring how catalogs are laid out — and every test
passed with it. Then the file itself was read, and `Save changes` appeared **twice**, once under each
boundary that used it.

That contradicts §8.1 directly. Context is metadata and never a key, so one string reached two ways
is _one_ translatable unit; exporting it per boundary asks a translator for the same words twice,
with nothing saying the answers must match — and since the hive is keyed by source text globally,
whichever answer arrived last would silently overwrite the other. The per-boundary shape is right for
a catalog, where the file _is_ the boundary, and wrong for an export.

Deduplication happens in the **compiler**, not the writer: "one string is one translatable unit" is a
semantic claim this document already settled, not a serialization preference. `ExportUnit` carries
`boundaryIds` and `contexts` as plurals for the same reason.

Worth recording because the test suite was no help. Thirteen tests passed against the wrong shape,
because every one of them asserted a note or a state that was present either way. The defect was only
visible in the artifact as a whole.

### 7.4 Step 4, as built

`ExchangeFacet.import` returns _proposals_; `import-gate.ts` decides. The facet knows the format and
whether its own states mean signed-off; the compiler owns the policy, which is the same division as
the export half.

Runs after `syncGraphs` and before anything is written, so an accepted translation reaches a catalog
and satisfies `verifyIntegrity` in the **same** build. An import that needs a second build to take
effect is an import people will reasonably believe is broken.

**§8.2 in XLIFF terms**: `reviewed` and `final` are approved; `translated` and `initial` are not.
`final`-only was considered and rejected on evidence rather than principle — plenty of TMS workflows
never set it, and a gate that imports nothing while reporting success is worse than no gate.

**Three outcomes, deliberately different.** Not approved → skipped silently, it is work in progress.
A key the source no longer has → skipped and counted, because the TMS always has older data than the
repo and failing there would mean every source edit breaks the next import. Corrupt → the build
fails, in one batched report, with **nothing merged**: a partial import leaves the project in a state
neither side believes in and nothing records which half landed.

The check no other tool we know of makes is the plural one. Arabic has six categories and English has
two, so a translator working from an English source sees two boxes; a system that round-trips the
English shape produces a message that silently renders the wrong form for four of them.
`Intl.PluralRules` answers this for free and cannot drift from the rules the baked output uses.

#### 7.4.1 No XML dependency, and the limit is reported

`@zintljs/compiler` has three dependencies and every one is installed by everybody, including people
who will never enable this facet — a parser in front of all of them for an opt-in feature is the
wrong trade. So the reader handles the shape this facet writes, and **says when it cannot read
something** rather than guessing: Zintl escapes markup into text on the way out, so a surviving `<`
means the other system used XLIFF inline elements, and that unit is refused by name through the same
report the semantic checks use. A limitation that announces itself is a gate doing its job; a
limitation that guesses is a corrupted string.

#### 7.4.2 The hive is not the catalog

Caught by a test, and it would have shipped. The first version merged accepted translations into the
hive and marked the hive dirty — which updates the compiler's own bookkeeping and leaves the JSON a
developer commits **untouched**, because catalogs are written per _boundary_ and only for dirty ones.

The import looked like it worked from every angle that was being checked: the hive had the value,
`verifyIntegrity` passed, the build was green. Only reading the catalog file on disk showed nothing
had changed. Accepted translations now mark every boundary carrying that string, which is why the
gate needs to know its carriers and not merely that the key exists.

## 8. Both decisions, taken

### 8.1 `context` is metadata, not a key — decided 2026-08-24

The field's old doc comment called it "disambiguation context", which reads as gettext's `msgctxt`:
the same text in two places becoming **two** separately translatable units. It is not that.

| Reading                                    | Verdict                                                                          |
| :----------------------------------------- | :------------------------------------------------------------------------------- |
| **Metadata** — a note to show a translator | **Chosen.** One translatable unit, annotated with where it appears.              |
| **Disambiguation key** (`msgctxt`)         | Rejected. Would split existing catalog keys — a migration with translation loss. |

This ratifies what the code already does rather than changing it, which is most of the argument for
it: `generateMessageId` ignores its `_context` parameter so one string reached through `title` and
`alt` stays one message, and `packages/extractor/src/__tests__/parser.context.test.ts` pins that. The
comment was the thing that was wrong, and it has been corrected in
`packages/compiler/src/reconcile.ts`.

**Three consequences worth carrying forward.**

_The collapse is now trivially safe._ `ExtractedMessage.contexts` is a `string[]` accumulated across
every site the text appears at; `ManifestEntry.context` is a single `string`. Joining a list is
lossless for metadata and would have been incoherent for a key. So step 1 in §7 no longer has a
design question inside it.

_The `msgctxt` problem is not solved, and should not be pretended away._ Two identical source strings
that need different translations in one locale cannot be told apart. The intended answer is that **two
strings needing different translations are two different strings** — change the source. That is
consistent with content-based identity and with "source stays plain": the distinction lives where a
reader of the code can see it, not in a side-channel key. `@zintl-note` covers the remaining case,
where the strings genuinely are the same and the translator just needs telling.

_Export can be generous._ Because context carries no identity, an exporter may attach as much of it as
a format allows — every recorded context, the note, the derived graph facts of §3 — without any risk
of changing what is translatable. That is what makes §3 cheap rather than delicate.

### 8.2 Does an in-review string ship? — decided 2026-08-28: no

**A TMS has `draft` / `in-review` / `approved`. Zintl has `translated` or `the build fails`.**

**Only `approved` is imported.** A `draft` or `in-review` translation is imported nowhere, the locale
stays incomplete, and `verifyIntegrity` fails exactly as it would have before anyone opened the TMS.

| Reading                    | Verdict                                                                                                                                                                               |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Only `approved` counts** | **Chosen.** `translated` keeps meaning one thing, and the hive stays stateless.                                                                                                       |
| In-review ships            | Rejected. A graded state entering a binary system means a passing `verifyIntegrity` no longer means "this locale is done", and somebody ships an unreviewed string believing it does. |

The argument is the one this project keeps making: the gate is worth having because it means exactly
one thing. Zintl already refuses to render a half-translated locale; accepting a half-_reviewed_ one
would reintroduce the same ambiguity through a side door, and it would be worse than the original
because the ambiguity would be invisible in the build output.

**The cost is real and is not hidden.** A translator can be blocked by their own reviewer, and a
review queue becomes a release dependency. That is a worse day for the translator than the
alternative, and it is the same trade the no-fallback rule already makes: the failure is loud, early,
and attributable, rather than quiet and shipped. Teams that need to unblock have the same escape
hatches they always had — `verifyIntegrity: false` for a release taken knowingly, or
`pendingLocales` ([031](031-pending-locales.md)) for a locale that is not ready to ship at all, which
is exactly the state a locale in first-pass review is in.

**Consequences for steps 3–4**, which are now unblocked:

- The hive needs **no state field**. State lives in the TMS, and the import reads it to decide whether
  to import, not to record it.
- `verifyIntegrity` gains **no second axis**. It still asks one question.
- The import facet's accept rule is a **constant, not an option**. A per-locale `acceptAt` was
  considered and rejected for now: it recreates the graded-state problem one config key along, and
  `pendingLocales` already covers the case that motivated it.

## 9. What this proposal does not cover

- Machine translation as a source. The fan-out in the original sketch (`LLM / Human / TMS`) is the
  same seam with a different consumer, and if §4's validation is real then an LLM-produced catalog is
  gated identically. Worth noting; not designed here.
- Pricing, vendor selection, or auth. A facet's transport concern.
- Bidirectional live sync. The loop in §0 is batch, deliberately: a build system with a network
  dependency in the middle of `flush()` is a different and much worse proposal.
- Anything about pending locales beyond noting they will meet — see [031](031-pending-locales.md).

## 10. What is actually left

Nothing in §7 1–4, and nothing waiting on a decision. Two things remain, and neither is a gap in the
seam.

**Step 5, vendor facets.** Never committed to here — "if ever. Possibly by other people" — and the
whole argument of §5 is that the first target should be a _format_ precisely so a vendor is additive
work someone outside this repository can do. A `crowdinFacet` would be evidence the seam holds, not a
missing piece of it.

**§1's corollary is undelivered.** It says a TMS whose fuzzy matching cannot be disabled per-import
is "a target we should document as degraded rather than support quietly", and no such note exists.
It matters more now than when it was written: the export ships a carry-forward pre-filled precisely
so the TMS's own matcher never gets a turn, and that reasoning only holds for a system that honours
the pre-filled target. One that re-matches anyway produces exactly the wrong-rename generator §1
describes, and Zintl would have no way to tell. Documented rather than detected, because there is
nothing in a returned file that distinguishes "the translator confirmed this" from "the TMS matched
it again".

Also worth stating plainly, because the §9 list is easy to mistake for a backlog: machine translation
as a source, vendor auth, and bidirectional live sync are **not** unfinished work. They are decisions
against, and §9 gives the reasons.
