# Proposal 033: Structural Defaults and Declared Targets

**Status**: OPEN — design, backed by a measurement (§1). The rule in §3 is settled in principle; §4–§6
are the mechanisms it needs, and §9 has the decisions that are not mine to make.
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

## 4. Declared targets: `obj:<name>:<field>`

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

### 4.3 The residual risk, stated

This is still name-based. Rename `ui` to `strings` and extraction stops silently.

What changes is _whose_ name it is. Today the silent break is keyed on a noun the user never chose —
`vanilla-ssr` translates only because somebody wrote `res.text`. Under this proposal it is keyed on a
convention the user declared in their own config, in their own codebase. Same mechanism, very
different accountability, and it is the accountability the rule in §0 is about.

## 5. `@zintl-target` — opt-in at the site

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

### 5.2 On the name

`@zintl-ui` was the first suggestion and is too narrow — a marked object may be SEO metadata, an API
payload with human-readable text, or an email template. **`@zintl-target`** matches the vocabulary the
config already uses (`targets: [...]`), so the same word names the concept in both places.

One wrinkle worth noting rather than solving: `@zintl-ignore` and `@zintl-target` do not read as
opposites, though they are. If that becomes a support question, the pair to consider is
`@zintl-ignore` / `@zintl-extract`.

## 6. `tag:` is the answer for self-built HTML

The DSL already has a `tag:<name>` family for tagged templates (`targets.ts:82`). A tagged template is
**structural** opt-in — the author marks the string as markup at the site, and the parser sees it:

```ts
const res = { text: html`<section>…</section>` };
```

This is currently undocumented, and it is the missing answer to _"how do I translate an HTML string I
build myself"_ — a common vanilla and SSR shape whose only working answer today is _name the field
`text`_.

## 7. The two survivors, and what replaces them

### 7.1 `vanilla-ssr`

The migration test for this whole proposal. `tag:html` (§6) is the intended answer: it says "this is
markup" instead of relying on a field name. Whatever this example ends up doing is what the docs will
tell every vanilla SSR user to do.

### 7.2 `vinext-basic`

Not a user problem at all. Next.js _declares_ that `metadata`, `generateMetadata`, `viewport` and
`generateViewport` carry user-facing and SEO-facing text — and `nextjsExtractionFacet` already names
all four, to suppress them. Turning that suppression into a **structural target** makes the framework's
own declaration the evidence, and removes the anchor-bypass dance the example currently performs.

This generalises: any framework with a declared metadata surface (Nuxt's `useHead`, SvelteKit's
`<svelte:head>`, Astro's frontmatter) gets a target rather than a guess. It is the same argument as
facets themselves — the framework knows; ask it.

## 8. Sequencing, and why this is pre-beta

`prune: true` is the default. If a string stops being extracted, its catalog key is removed **and its
translations with it**.

So narrowing these defaults is free today and a **translation-loss event** after beta. Post-beta the
choice becomes: ship a known-wrong default forever, or delete people's work. That asymmetry is the
whole sequencing argument.

Order:

1. Add `obj:<name>:<field>` and `call:<fn>:<field>` (§4). Additive; nothing breaks.
2. Add `@zintl-target` (§5). Additive.
3. Document `tag:` and migrate `vanilla-ssr` (§6, §7.1).
4. Turn the Next.js metadata suppression into a target and migrate `vinext-basic` (§7.2).
5. **Only then** remove nominal targets from the defaults — with every example already migrated, so
   the contract suite proves the removal rather than absorbing it.

Steps 1–4 are each independently useful and independently shippable. Step 5 is the breaking one and
goes last, which is also what makes its changeset honest: by then the answer to "what do I do
instead?" is documented and demonstrated.

## 9. Open questions

### 9.1 How absolute is the rule for `dom:prop:*`?

§0 says _never_, which drops the whole family — including `textContent` and `innerHTML`, which are how
vanilla apps write text. That is a far larger behavioural change than `obj:field:*`.

§2.1 offers a middle: keep the DOM coinages (`innerHTML`, `textContent`, `innerText`), drop the
English words (`title`, `value`, `alt`, `placeholder`, `label`, `description`, `aria-*`). Still
nominal, but the name is strong evidence — nobody calls an ordinary field `innerHTML`.

This needs deciding explicitly, not sweeping in with the object fields.

### 9.2 Does a declared target belong in config, or in the facet?

`targets` sits on facet options, so `obj:ui:title` is passed via `vanillaFacet({ targets: [...] })` —
which replaces the default list wholesale. For "the defaults plus one of mine" that is awkward. A
top-level `additionalTargets` would be friendlier, and would be the third instance of the
option-versus-facet overlap already flagged as the surface most likely to change before 1.0
(`docs/stability.md`).

### 9.3 Should `obj:<name>` match the exported name or the local one?

`const ui = {…}; export { ui as strings }`. The declaration site says `ui`; consumers see `strings`.
The local name is what the visitor has, and it is probably right — but it should be written down
before someone relies on the other reading.

## 10. What this proposal does not cover

- **Which structural targets are missing.** This argues about what defaults may contain, not whether
  the current structural set is complete. `dom:attr:*` is listed in the DSL docblock (`targets.ts:6`), declared in the
  descriptor union (`types.ts:244`), parsed (`targets.ts:89`) — and consumed by nothing. It pushes a
  fast-path hint and is never added to any target set, so it matches nothing. Dead syntax or an
  unfinished feature; either way it is worth its own look, and it should not be discovered by a user
  who tried it.
- **The `sinkType` gap** from proposal 032 §7.1 — every HTML text node arrives as `HTML_TEXT`, so an
  `<h1>` and a `<p>` are indistinguishable downstream. Related, since both are about extraction
  carrying more evidence, but independently decidable.
- **Any TMS interaction.** Declared targets change _what_ is extracted, not how it is exported.
