---
"@zintljs/compiler": minor
---

Stop extracting `el.title`, `el.value` and friends by default.

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
