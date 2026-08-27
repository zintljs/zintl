---
"zintljs": minor
---

Make a facet you name replace the built-in of the same name, instead of losing a coin flip.

`facets: ["builtins", assetsFacet({ targets: ["mdx"] })]` is the obvious way to reconfigure one
built-in, and it is the shape the docs show. It did not work. Both facets are called
`system-static-assets`, both sit at priority 0, and `resolveFacets` dedupes by name over a stable
sort — so the one listed first won. Listing `"builtins"` first, as the docs do, silently discarded
the user's.

Written the other way round it worked. Nothing said which you had.

That is a direct violation of the invariant `activate.ts` states in its own header: _order is
deliberately not load-bearing_ — membership is decided by activation, precedence by `priority`, and
neither is supposed to care what order facets were registered in. The name-dedupe made registration
order decide a user-visible outcome, quietly.

`flattenFacets` now tracks provenance. A facet the caller named by hand replaces the built-in of the
same name wherever either appears in the list, and the replaced name comes back so the activation
trace can report it:

```
✗ system-static-assets (built-in)   replaced by the "system-static-assets" facet you passed
```

Silence was the actual defect here, not the choice of winner.

Bundler facets go through the same rule. They are appended as always-candidates rather than listed,
so they used to be last and would lose to a user facet by position alone — the right outcome, by the
wrong mechanism. A project shipping its own `vite` facet now replaces ours because it said so.

The dedupe in `resolveFacets` stays as a last-resort tiebreak for same-name facets that arrive by
another route — a direct `resolveFacets` call, as the test harness makes — and is now documented as
a rule rather than left to emerge from sort stability. The harness comment that had been quietly
working around this since it was written is updated to say which mechanism it is relying on.
