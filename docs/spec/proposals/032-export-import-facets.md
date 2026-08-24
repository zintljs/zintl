# Proposal 032: Export/Import Facets — the TMS Seam

**Status**: OPEN — design, not authorised work. §8.1 is decided (`context` is metadata, not a key);
§8.2 remains, and is a product question rather than a technical one. Steps 1–2 of §7 are unblocked.
**Date**: 2026-08-24
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
- **What expression produced `{input}`** — `{input}` alone is unanswerable; `user.firstName` is not.
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

## 6. The format tension, stated rather than resolved

§2 and §3 mean the interchange **cannot** be `{ source: "" }` — that shape has nowhere to put context.

| Format         | For                                                             | Against                                                          |
| :------------- | :-------------------------------------------------------------- | :--------------------------------------------------------------- |
| JSON key/value | Hand-editable; already what catalogs are; zero new concepts     | Carries no context, no state, no notes — the whole §3 value lost |
| **XLIFF 2.0**  | `<unit id>`, `<notes>`, `<segment state>`; every TMS ingests it | Heavy; XML; not something anyone hand-edits                      |

Probable answer: **both, at different layers.** JSON stays the repo format and the thing a human
edits; XLIFF is what the export facet emits and the import facet consumes. The repo never gains an XML
file unless someone asks for one. This keeps the "plain JSON you can open" property that people will
like, while giving the TMS seam a format that can carry §3.

## 7. Sequencing

Each step is independently useful, which is the test of whether the decomposition is right.

1. ~~**Populate `ManifestEntry.context`**~~ — **done**, and it corrected this document twice on the
   way. See §7.1.
2. **Derive the graph context of §3** behind one method, e.g. `getMessageContext(boundaryId, key)`.
   Pure read, testable without any TMS.
3. **Export facet**, format-first (XLIFF), with §1's pre-filled carry-forwards.
4. **Import facet with validation** (§4) before any merge is attempted. The gate lands before the
   convenience, deliberately.
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

## 8. One decision taken, one question still blocking

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

### 8.2 Does an in-review string ship? — still open

**A TMS has `draft` / `in-review` / `approved`. Zintl has `translated` or `the build fails`.**

- **Yes** → a graded state enters a binary system, and "translated" stops meaning one thing.
- **No** → translators find builds blocked by their own reviewers, and the review queue becomes a
  release dependency.

A product decision, not a technical one. It determines the shape of the import facet, what
`verifyIntegrity` counts, and whether the hive needs a state field at all. **Steps 3 onward in §7
should not start before it is answered**; steps 1 and 2 are now unblocked by §8.1.

## 9. What this proposal does not cover

- Machine translation as a source. The fan-out in the original sketch (`LLM / Human / TMS`) is the
  same seam with a different consumer, and if §4's validation is real then an LLM-produced catalog is
  gated identically. Worth noting; not designed here.
- Pricing, vendor selection, or auth. A facet's transport concern.
- Bidirectional live sync. The loop in §0 is batch, deliberately: a build system with a network
  dependency in the middle of `flush()` is a different and much worse proposal.
- Anything about pending locales beyond noting they will meet — see [031](031-pending-locales.md).
