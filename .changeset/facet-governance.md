---
"@zintljs/compiler": minor
"zintljs": patch
---

Make every facet fan-out declare how it composes, and draw the bundler-support line.

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
