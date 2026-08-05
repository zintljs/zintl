---
"@zintljs/compiler": minor
"zintljs": minor
---

Facets now decide for themselves when they apply, instead of being selected by a table in the plugin. This is the self-activation inversion proposal 026 was sequenced to inform, and it uses that spike's leak ledger as its input.

`autoFacets` no longer chooses. Every built-in facet is offered as a candidate and each answers for itself: the framework switch, `if (ssr && !isNext)` and `if (!isNext)` are gone, and the decisions they encoded are declarations on the facets that own them. Adding a framework now means shipping a facet that knows its own condition rather than editing core.

**A facet declares its condition as data**, not as a predicate:

```ts
{ name: "react-codegen", when: { framework: "react" } }
```

`when` supports `framework`, `bundler`, `dependency`, `ssr` and `dev`; all present fields must hold, and an omitted `when` means unconditional with no check performed. An optional `activate(ctx)` escape hatch covers what a descriptor cannot express. The reason for preferring data is the trace: a predicate can only report _that_ it said no, where a descriptor reports `when.framework=vue ✗ (detected: react, nextjs)`.

**Activation is not a boolean.** `provides` / `supersedes` / `conflicts` let one facet replace another — Next.js supersedes the generic SSR wrapper and client-SPA facets, targeting a provided capability rather than a hardcoded name. That was previously an `if (!isNext)` whose reason lived in a comment. `conflicts` is the hard-error case for pairs with no sensible winner.

**Every decision is explained.** Activation emits a trace covering active and inactive facets alike, and it is committed to the per-example composition golden files, so "why is React support off?" is answerable from a text file.

**Bundler facets are now host-conditional.** `viteFacet` declares `when: { bundler: "vite" }` rather than being appended to every project. This fixes a real leak: Rspack builds were being handed `import(/* @vite-ignore */ …)`, a Vite annotation in output no Vite ever reads. Bundler facets remain unconditional _candidates_ — opting out of the built-in set should not silently strip host integration — but being a candidate is no longer the same as being active.

**Option surface — breaking.** `facets: ["auto", …]` becomes `facets: ["builtins", …]`, and `"auto"` is **removed rather than aliased**: it is now a type error. The sentinel was misnamed — it reads as "be automatic", but automatic is no longer optional; what it selects is which _set_ of facets is on the table. Zintl is pre-1.0 with no users to migrate, and a silent second spelling is a migration nobody ever finishes.

New `excludeFacet(name)` drops a single builtin, which previously required listing every facet by hand and keeping that list in sync.

Composition is unchanged for every existing example on Vite.
