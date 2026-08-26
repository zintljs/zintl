# Proposal 033: Structural Defaults and Declared Targets

**Status**: CLOSED, with nothing outstanding. Every section is built and every question it raised is
answered — see §8 for the order the work happened in, §8.1 for what the removal cost (nothing), and
§8.1a for the three places the audit was blind. Originally: design, backed by a measurement (§1). The rule in §3 is settled in principle; §4–§6
are the mechanisms it needs. §9.1 is decided and **shipped**, including the
receiver-qualified `dom:<receiver>:<property>` descriptor it needed. **§8 is complete**: §4, §5, §6, §7 and §10 are all
built, and `obj:field:*` is gone from the defaults with zero strings lost (§8.1). §9.2 (`additionalTargets`) and §9.3 (local binding) are
both answered. The rule in §0 now holds across every default target, with no exception.
**Date**: 2026-08-24
**Kind**: Design proposal, with an audit attached. Every number below was produced by running the
extractor, not by reading it.
**Depends on**: the target descriptor DSL (`packages/extractor/src/targets.ts`), the facet presets
(`packages/compiler/src/facet/presets/`), comment directives (`docs/directives.md`), and `prune`
(`packages/zintl/src/types.ts`).

## 0. The rule this exists to enforce

> **A default sink target must never catch text that is not user-facing.**
>
> A user may add whatever targets their codebase needs, and owns the consequences. Manual `t()`
> remains available for everything else.

Today's defaults break that rule by construction, and §1 measures how far.

## 1. The audit

Method: for every example, extract twice — once with the built-in facets as resolved, once with every
`obj:field:*` target stripped from them — and diff the key sets. Run at `d577ad0`.

### 1.1 The numbers

|                                       |                                                   |
| :------------------------------------ | :------------------------------------------------ |
| Examples depending on `obj:field:*`   | **2 of 30**                                       |
| Strings that exist only because of it | **16**                                            |
| `vanilla-ssr`                         | 14 strings — **14 → 0** with the targets stripped |
| `vinext-basic`                        | 2 strings                                         |

28 of 30 examples never touch it. That sounds like a small blast radius, and then you look at what the
two are.

### 1.2 Both survivors are accidents of naming

**`vinext-basic`** — `generateMetadata()` returns `{ title, description }`. SEO metadata, caught by
`obj:field:title` and `obj:field:description`: a guess about a noun.

The route it takes there is worth following. The Next.js facet _suppresses_ `generateMetadata` by
default (`nextjsExtractionFacet`, `suppressionRules`), the example writes `await zintl(locale)` inside
it, that trips `bypassIf: "hasAnchor"` and re-enables the site — and then a nominal target does the
actual work. **The facet already knows those four identifiers by name. It suppresses them instead of
targeting them.**

**`vanilla-ssr`** — the entire server-rendered document is:

```ts
const res = {
  text: `
    <section id="center"> … </section>
  `,
};
```

`obj:field:text` is the only reason the compiler opens that template. Rename `text` to `body` and the
whole page stops being translated — **silently**, because nothing is extracted, so `verifyIntegrity`
has nothing to check and reports success.

### 1.3 It is not only object fields

`dom:prop:*` matches on a property name with no knowledge of the receiver:

```ts
featureFlag.value = "NON_DOM_value"; // extracted
telemetry.title = "NON_DOM_title"; // extracted
sqlBuilder.innerHTML = "NON_DOM_innerHTML"; // extracted
```

None of those are DOM nodes. Nothing checks.

### 1.4 The failure is bidirectional, and both directions are silent

This is the part that matters more than the counts.

| Direction            | What happens                                                                                                           | Who notices                                                 |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **Over-extraction**  | Extraction _rewrites the value_: `{ label: _t("signup_button_click") }`. In Arabic the analytics event name is Arabic. | Nobody, until telemetry is wrong                            |
| **Under-extraction** | A real UI string is never extracted, so it is never in a catalog                                                       | Nobody — `verifyIntegrity` only checks what _was_ extracted |

The no-fallback gate is the project's loudest safety mechanism and it is structurally blind to the
second case. And the first case is a build blocker as well as a data bug: every false positive must be
translated before the build passes.

## 2. Structural versus nominal

|                | Targets                                      | The evidence                                                          |
| :------------- | :------------------------------------------- | :-------------------------------------------------------------------- |
| **Structural** | `html:attr:*`, `jsx:*:*`, HTML text, `tag:*` | The parser knows the string is inside markup, or the author tagged it |
| **Nominal**    | `obj:field:*`, `dom:prop:*`                  | A name matched; the receiver is unknown                               |

Nominal targets cannot be fixed by curating the name list, because the name _is_ the entire signal.
They also cannot be fixed by inspecting the receiver: extraction runs on an oxc parse with no type
information, and dataflow tracing was deliberately removed (backlog 005).

### 2.1 One sharpening worth keeping

Not all names are equally weak. `innerHTML`, `textContent` and `innerText` are **DOM coinages** — no
one names an ordinary field `innerHTML`. `title`, `text`, `label`, `value`, `description` are ordinary
English words that appear on configs, payloads and telemetry.

So there is a defensible middle for `dom:prop:*` specifically: keep the reserved coinages, drop the
English words. §9.1 is the decision.

## 3. The proposed rule

1. **Defaults contain structural targets only.**
2. **Nominal matching is available, and declared** — by the user, in their own config or at the site.
3. **Framework-declared user-facing surfaces become structural targets**, because the framework has
   already said what they are. Next.js metadata is the first (§7.2).

## 4. Declared targets: `obj:<name>:<field>` — built 2026-08-25

The DSL is already qualified elsewhere — `jsx:<element>:<attr>`, with `*` for any element
(`targets.ts:64`). So this is the same shape rather than a new concept:

```ts
zintl({ facets: ["builtins", vanillaFacet({ targets: [...structural, "obj:ui:title"] })] });
```

`obj:*:title` spells today's behaviour honestly — _any object, anywhere_ — and stays available.

### 4.1 It works, including for functions

Ancestor chains, probed against a real oxc parse:

```
"A" const ui = { title }              ← VariableDeclarator(ui)              1 hop
"B" const mk = () => { return {…} }   ← Return < Block < Arrow < Decl(mk)   4 hops
"C" const mk2 = () => ({ title })     ← Paren < Arrow < Decl(mk2)           3 hops
"D" function build() { return {…} }   ← Return < Block < FnDecl(build)      ✔
"E" export default { title }          ← ExportDefaultDeclaration            ✘ no name
"F" cfg({ title })                    ← CallExpression<cfg>                 callee, not a binding
"G" class K { ui = { title } }        ← PropertyDefinition[ui]              ✔
"H" const nested = { header: {…} }    ← Property[header] < Decl(nested)     ✔ at depth
```

The visitor already receives the full `parents: Node[]` chain
(`packages/extractor/src/visitors/bindings.ts:273`), so the rule — _walk up to the nearest
name-carrying ancestor_ — needs no new plumbing. Seven of eight shapes resolve.

### 4.2 Three things the probe forces a decision on

**`export default { … }` has no name** (row E). Either a sentinel (`obj:default:title`) or it is
simply not addressable this way, and §5 covers it instead.

**`cfg({ … })` yields a _callee_, not a binding** (row F). "The object passed to `cfg()`" is a
genuinely valuable target — `defineConfig({…})`, `createChart({ title })` — but it is a different
relation, and folding it into `obj:` would be a trap. It wants its own spelling: **`call:<fn>:<field>`**.

**Nesting needs a stated depth rule** (row H). `const ui = { home: { title }, about: { title } }` is
what a real strings object looks like, so `obj:ui:title` should match at **any depth** below the
binding. Direct-child-only would make the feature useless for its main use case.

### 4.2a As built

Both families ship. `obj:<binding>:<field>` with `obj:*:` and `obj:field:` as the any-object
spellings; `call:<function>:<field>` as its own family, for the reason §4.2 gives.

The three decisions §4.2 forced were settled as proposed: `export default { … }` is **not
addressable** (no name to declare against — §5's directive is the answer), `cfg({ … })` got its own
`call:` spelling rather than being folded into `obj:`, and the binding is matched at **any depth**
below it, because `{ home: { title }, about: { title } }` is what a strings object actually looks
like.

One thing the probe in §4.1 did not predict, and it is worth recording because it inverts the
obvious reading: **`parents[0]` is the _immediate_ parent** — `walker.ts` builds the chain as
`[node, ...parents]`, so ascending index walks _outward_. Iterating in reverse reads naturally and is
wrong: an enclosing binding answers before the call or object nearer the literal, so
`const cfg = defineConfig({ title })` resolved to `cfg` and missed `call:defineConfig:title`.

### 4.3 The residual risk, stated

This is still name-based. Rename `ui` to `strings` and extraction stops silently.

What changes is _whose_ name it is. Today the silent break is keyed on a noun the user never chose —
`vanilla-ssr` translates only because somebody wrote `res.text`. Under this proposal it is keyed on a
convention the user declared in their own config, in their own codebase. Same mechanism, very
different accountability, and it is the accountability the rule in §0 is about.

## 5. `@zintl-target` — opt-in at the site — built 2026-08-25

The directive vocabulary is `@zintl-ignore`, `@zintl-note`, `@zintl-pass`. **There is no opt-in
directive**, and that is the missing half.

```ts
// @zintl-target
export default { title: "…", description: "…" };
```

### 5.1 Why a marker as well as a descriptor

They fail in opposite places, which is the argument for having both:

|                                        | `obj:<name>:<field>`               | `@zintl-target`          |
| :------------------------------------- | :--------------------------------- | :----------------------- |
| Cost                                   | One config line, zero source edits | A comment per site       |
| Fits                                   | A codebase with a convention       | Ad-hoc objects, one-offs |
| Survives a rename                      | No                                 | Yes                      |
| Visible to someone reading the file    | No                                 | Yes                      |
| Handles `export default` / inline args | No (§4.2)                          | Yes                      |

A project uses the descriptor for its convention and the directive for the exceptions. Neither is a
default, so §0 holds either way.

### 5.1a As built

A region, not a per-node flag — `pushTarget`/`popTarget` mirroring `pushSuppression`, and a counter
rather than a boolean because regions nest and an inner one ending must not end the outer. Inside one,
every string field of an object literal is a sink regardless of its name; `@zintl-ignore` is still
honoured within, so the pair composes.

It attaches to the statement shapes that can carry a directive above an object: `VariableDeclaration`,
`ExportDefaultDeclaration`, `ExpressionStatement`, `ReturnStatement`, `PropertyDefinition`. The last
two are there so a marked region behaves the same wherever an object is produced, matching how §4's
binding walk crosses function bodies.

**The `Property` visitor's registration gate had to be kept.** It was previously "any object-field
target is configured"; a `@zintl-target` can exist with no targets configured at all, so the gate now
also asks whether the file contains the directive — a one-off string scan per file rather than a
per-node check. Removing the gate instead makes the visitor run on every `Property` in every project,
including the many with no object targets, to answer "no" each time.

### 5.2 On the name

`@zintl-ui` was the first suggestion and is too narrow — a marked object may be SEO metadata, an API
payload with human-readable text, or an email template. **`@zintl-target`** matches the vocabulary the
config already uses (`targets: [...]`), so the same word names the concept in both places.

One wrinkle worth noting rather than solving: `@zintl-ignore` and `@zintl-target` do not read as
opposites, though they are. If that becomes a support question, the pair to consider is
`@zintl-ignore` / `@zintl-extract`.

## 6. `tag:` is the answer for self-built HTML — a default since 2026-08-25

The DSL already has a `tag:<name>` family for tagged templates (`targets.ts:82`). A tagged template is
**structural** opt-in — the author marks the string as markup at the site, and the parser sees it:

```ts
const body = html`<section>…</section>`;
```

It was undocumented, and it is the answer to _"how do I translate an HTML string I build myself"_ — a
common vanilla and SSR shape whose only working answer used to be _name the field `text`_.

`vanillaFacet` now declares `tag:html`, so it takes no configuration. That is defensible where a field
name is not: a tag cannot fire by accident, because the author has to write ``html`…` `` around the
string. Lit already declared the same target and the two union.

## 7. The two survivors, and what replaces them

### 7.1 `vanilla-ssr` — migrated 2026-08-25

```diff
- const res = {
-   text: `
+ const body = html`
      <section id="center"> … </section>
- `,
- };
- return { html: res.text };
+ `;
+ return { html: body };
```

All 15 strings survive, and the file now says what the string _is_ at the site instead of depending on
a field being called `text`. The tag function is four lines of `String.raw`, and its comment records
what the old shape cost: renaming `text` to `body` would have stopped the whole page being translated,
silently, because nothing extracted means nothing to report.

This is the migration the docs point vanilla and SSR users at.

Two things it turned up that a reader migrating their own code should expect. **The formatter can see
inside a tagged template**, so oxfmt re-wrapped the SVG and list markup across lines — cosmetic, and
extraction was verified unchanged by content rather than by count. And **`vanilla-ssr` has three
snapshot contracts, not two**: `build`, `transform-dev` and `transform-prod`. Updating two of them left
the gate red, which is the third time on this change that the suite knew where something lived and the
audit did not (§8.1a).

### 7.2 `vinext-basic` — migrated 2026-08-25

`nextjsExtractionFacet` now declares `obj:metadata:title`, `obj:metadata:description`,
`obj:generateMetadata:title` and `obj:generateMetadata:description`. Both SEO strings survive, and the
framework's own contract is the evidence rather than a guess about a noun.

**The suppression rule shrank to `viewport` and `generateViewport`.** All four names used to be
suppressed with `bypassIf: "hasAnchor"`, which made extraction from metadata conditional on putting a
`zintl()` call inside the function. That happened to work for `generateMetadata`, where an app needs an
anchor anyway to resolve the locale — and left the far more common static
`export const metadata = { … }` unreachable: no anchor, no strings, no message. A framework that
declares its own metadata surface should not need the user to smuggle a directive into it.

`viewport` stays suppressed and needs no target: `width`, `initialScale` and `themeColor` are not
prose. Naming `title` and `description` rather than un-suppressing wholesale is what keeps `icons`,
`robots` and the Open Graph URLs out.

## 8. Sequencing, and why this is pre-beta

`prune: true` is the default. If a string stops being extracted, its catalog key is removed **and its
translations with it**.

So narrowing these defaults is free today and a **translation-loss event** after beta. Post-beta the
choice becomes: ship a known-wrong default forever, or delete people's work. That asymmetry is the
whole sequencing argument.

Order, as executed:

1. ~~Add `obj:<name>:<field>` and `call:<fn>:<field>` (§4).~~ **Done** — additive, nothing broke.
2. ~~Add `@zintl-target` (§5).~~ **Done** — additive.
3. ~~Document `tag:` and migrate `vanilla-ssr` (§6, §7.1).~~ **Done.**
4. ~~Turn the Next.js metadata suppression into a target and migrate `vinext-basic` (§7.2).~~ **Done.**
5. ~~Remove nominal targets from the defaults.~~ **Done** — `obj:field:*` is gone from `vanilla`,
   `jsx`, `lit`, `svelte` and `vue`.

### 8.1 What the removal cost, measured

The same harness as §1, re-run across all 30 examples after step 5: **every example extracts the same
number of strings as before.** For the two that depended on `obj:field:*`, the actual strings were
compared rather than the counts, because equal counts do not prove equal contents:

| Example        | Before | After | Via                      |
| :------------- | :----- | :---- | :----------------------- |
| `vanilla-ssr`  | 15     | 15    | `tag:html`               |
| `vinext-basic` | 13     | 13    | `obj:generateMetadata:*` |

Zero strings lost. That is what steps 3 and 4 were for, and it is why step 5 is a changeset rather
than a migration guide.

#### 8.1a Where the audit was blind, three times

The measurement above is sound and its _scope_ was wrong three times over, each caught by the contract
suite rather than by the audit:

| Missed                                     | Why the audit could not see it                           |
| :----------------------------------------- | :------------------------------------------------------- |
| `document.title` in eight manifests (§9.1) | Fixtures **synthesize** source at test time              |
| `tests/fixtures/ssr-streaming.ts`          | Fixtures define projects **inline**, outside `examples/` |
| `transform-prod` snapshot                  | Three snapshot contracts drive `vanilla-ssr`, not two    |

One lesson, stated once so the next person does not learn it three times: **an audit that walks
`examples/` is measuring a fraction of what the suite drives.** Any change to the default target set
needs `vpr ready:examples`, not a source scan — and the scan is worth running first only because it is
cheap, never because it is sufficient.

### 8.2 The one thing it does cost users: Vue's Options API

Strings in a `data()` return are ordinary object fields:

```vue
<script>
export default {
  data() {
    return { field: { label: "Script only string" } };
  },
};
</script>
```

`obj:field:label` used to reach that. Nothing else does, and **`obj:<binding>:<field>` cannot**: `data`
is a property of the default-exported object, not a declaration, so the binding walk has no name to
resolve. `@zintl-target` on the return is the answer, and `sfc_integration.test.ts` now carries that
shape so the migration is demonstrated rather than described.

This is the only migration the removal forces, and it is worth stating plainly in the changelog rather
than leaving a Vue user to find it.

## 9. Open questions

### 9.1 `dom:prop:*` — decided 2026-08-24: keep the coinages, drop the English words

**Kept:** `innerHTML`, `textContent`, `innerText`, and `title` — the last receiver-qualified as
`dom:document:title`, which is what makes it admissible.
**Dropped:** `alt`, `placeholder`, `aria-label`, `aria-description`, `value` — variable receivers, so
there is no evidence available to qualify them with.

The line is §2.1's: `innerHTML` is a DOM coinage, so the name is itself the evidence. `alt`, `value`
and the rest are English words that appear on configs and telemetry, and as _defaults_ they broke §0
by construction.

#### The measurement that was not enough

The static audit said **0 of 30 examples affected, 0 strings lost**, and it was wrong — not in its
arithmetic, but in its scope. It read the examples **as committed on disk**. Contract fixtures
_synthesize_ source at test time, and eight of them insert exactly this:

```js
await zintl(extraLang);
document.title = "Extra anchor added"; // a dom:prop:title sink
```

That line is what gives the new anchor's boundary content. Without it the graph does not grow, so the
structural-HMR route is never taken and `[HMR Growth]` fails on `rsbuild-react-basic` and
`rsbuild-vue-basic`. Measured with `scripts/flake.js`, both conditions in one batch:

| Condition            | Result           | Per run |
| :------------------- | :--------------- | :------ |
| With the six removed | **10/10 failed** | 112s    |
| Baseline             | **0/10 failed**  | 45s     |

**The lesson generalises past this change: an audit of static sources cannot see strings that tests
synthesize, and this repository's contract fixtures synthesize a lot of them.** Any future change to
the default target set needs the contract suite as well as a source audit — and `--runs=10` with a
same-batch baseline is what turns "2 tests failed" into a number that means something.

#### `title` came back, and then stopped being an exception

`document.title` is the browser tab. It is as user-facing as text gets, and dropping it stopped real
page titles being extracted — a genuine regression, not a fixture artifact.

It differs from its five neighbours in exactly one way that matters: **its receiver is the `document`
global**, a literal identifier in the source. That is structural evidence, the same kind
`jsx:<element>:<attr>` rests on. `img.alt`, `input.placeholder` and `x.value` have variable receivers
and no such evidence.

`dom:prop:` could not use it, because it matched a property name and nothing else — so
`telemetry.title` was extracted too, which is the defect this whole change was about.

#### Resolved: `dom:<receiver>:<property>` — built 2026-08-25

The `dom:` family is now qualified the way `jsx:` always was:

```
dom:prop:innerHTML     any receiver          (the original spelling, unchanged)
dom:*:innerHTML        any receiver          (alias — jsx's convention, so there is only one)
dom:document:title     document.title only   (new)
```

`vanillaFacet` declares `dom:document:title`, and the exception is gone — §0 holds with no carve-out:

```js
document.title = "REAL_PAGE_TITLE"; // extracted
telemetry.title = "NOT_UI_title"; // not
chart.title = "NOT_UI_chart_title"; // not
```

The receiver must be a plain identifier. `window.document.title` does **not** match, deliberately:
following member chains means walking arbitrary receivers, which re-admits the guessing the
descriptor exists to remove. Asserted as a floor rather than left to be discovered. The check runs
only when the any-receiver set misses, so the common path is untouched.

**This is the argument for §4 as well.** Qualification was proposed there as an opt-in convenience for
users with a naming convention; it turns out to be what closes a hole in the _defaults_. The same
reasoning carries to `obj:<name>:<field>`.

`obj:field:*` was untouched at the time this section was written; §8 step 5 has since removed it.

### 9.2 Declared targets in config — answered 2026-08-25: `additionalTargets`

`targets` sits on facet options and **replaces** that facet's list, which is right for reconfiguring
one and useless for _"the defaults plus one of mine"_: appending a single entry meant re-listing every
default, and such a config falls behind silently the moment the defaults move.

There was a route — contribute your own facet, since array capabilities union across them — but it
required knowing that facets union, that `concern: "extraction"` is the slot, and that the name must
differ from a built-in or the provenance rule _replaces_ instead. Too much mechanism for one target.

`additionalTargets` is a top-level option that adds:

```ts
zintl({ additionalTargets: ["obj:details:*"] });
```

**Not the option/facet duplication this document warned about.** Facet `targets` replaces one facet's
list; `additionalTargets` extends the resolved set. Different jobs, so they never compete for the same
meaning — which is exactly what `assetsTarget` and the assets facet's `targets` do, and why that pair
is still the surface most likely to change before 1.0.

It is carried as a synthetic facet named `additional-targets`, so it inherits union semantics, appears
in the activation trace, and needs no second code path that could disagree with the first. Its own
name matters: naming it after a built-in would _replace_ that facet under §4's provenance rule.

**A sentinel was considered and rejected.** `targets: ["auto", …]` would mirror `facets: ["builtins"]`,
but `facets` is expanded by the plugin while `targets` is parsed by the extractor's deliberately
framework-blind DSL — so the sentinel would either leak an orchestration concept into that parser, or
mean one thing at the top level and another on a facet. It also reserves a bare word in a namespace of
prefixed descriptors, foreclosing any future bare-word form.

#### 9.2a The wildcard was only half-implemented

Found while answering this. `*` was supported in the **binding** position (`obj:*:title`) and not the
**field** position: `obj:details:*` parsed, stored `"*"` as a literal field name, matched nothing, and
**passed validation** — a structurally valid triple with no empty segments. Silently doing nothing, one
position over from where §10's validation pass had just removed it.

`obj:details:*` is also the more useful half: it says _this object holds UI strings_ without listing
them. Both positions now work, for `obj:` and `call:` alike.

### 9.3 `obj:<name>` matches the **local** binding — answered 2026-08-25

```ts
const ui = { title: "…" };
export { ui as strings };
```

`obj:ui:title` matches this. `obj:strings:title` does not. The export alias is ignored, and that is
the behaviour the implementation already had — the question was whether to keep it.

Three reasons to keep it, in ascending order of weight.

**It is what the walk can see.** The binding comes from the nearest name-carrying ancestor of the
object literal. An alias lives in a separate export declaration elsewhere in the module, so honouring
it means a second resolution pass over the module's export bindings, feeding a decision made at the
literal.

**There is not always one exported name.** `export { ui as strings, ui as messages }` is legal, and a
re-export chain adds more. "The exported name" is not well-defined, while the local binding always is
— a rule that cannot be stated for every input is not a rule.

**A target is a statement about the shape of the source, not about a module's public surface.** The
person writing `obj:ui:title` is reading the file the object is written in, and the answer to "does
this match?" should be available from the declaration alone, without scanning the module's exports.
That locality is the same instinct `@zintl-target` follows by marking the site.

The cost is that a consumer importing `strings` must use the _defining_ module's name. That is
acceptable because targets are project configuration, written by somebody who can open the file.

This adds no new fragility: §4.3 already records that renaming the binding silently stops extraction,
and export aliasing does not make that worse. Asserted in
`qualified_object_targets.test.ts` under "which name counts", including the inverted case where the
alias happens to be the target and must **not** match.

## 10. What this proposal does not cover

- **Which structural targets are missing.** This argues about what defaults may contain, not whether
  the current structural set is complete. `dom:attr:*` is listed in the DSL docblock (`targets.ts:6`), declared in the
  descriptor union (`types.ts:244`), parsed (`targets.ts:89`) — and consumed by nothing. It pushes a
  fast-path hint and is never added to any target set, so it matches nothing.
- ~~**Descriptor validation**~~ — **built 2026-08-25.** An unrecognised descriptor used to be silently
  ignored: `obj:ui:title` (§4's proposed form, not yet real) and a typo like `dom:prop:titel` both
  resolved to zero targets and reported nothing, which is §1.4's silent under-extraction arriving
  through a config file — worse there, because the intent was stated out loud and dropped. Every form
  now either matches or is refused at construction with the valid forms listed, covering unknown
  prefixes, wrong arity, empty segments and paths where a name is expected. `dom:attr:` is refused
  explicitly as never-implemented rather than accepted-and-inert, which also retired the assertion in
  `targets.test.ts` that had recorded that no-op as a feature.
- **The `sinkType` gap** from proposal 032 §7.1 — every HTML text node arrives as `HTML_TEXT`, so an
  `<h1>` and a `<p>` are indistinguishable downstream. Related, since both are about extraction
  carrying more evidence, but independently decidable.
- **Any TMS interaction.** Declared targets change _what_ is extracted, not how it is exported.
