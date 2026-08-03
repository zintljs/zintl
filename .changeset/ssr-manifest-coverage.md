---
"@zintljs/compiler": patch
---

Add the three unmanifested SSR examples to the contract suite.

`svelte-ssr`, `vue-ssr` and `vanilla-ssr` existed under `examples/` and were built by `build:examples`, but no contract had ever run against them — SSR coverage was React only. Every SSR-shaped contract now runs across four frameworks: **94 contract tests, up from 76, for about six seconds.**

That matters most where the frameworks genuinely differ. SSR codegen for Vue and Svelte single-file components goes through different facet paths than JSX, and until now the only thing checking either in SSR mode was a production build with nothing asserting its output. The three new manifests bring `transform`, `build`, `graph` and `boundary-graph` snapshots with them — 99 of them — so a change to SFC handling under SSR is now visible as a diff rather than as a downstream surprise.

**Their capability lists are deliberately narrower than `react-ssr`'s.** That manifest also claims `hmr`, `locale-switch` and `rtl`, and none of the three matches anything: every contract requiring them also requires `spa`, which an SSR project does not have. Inert claims cost nothing at runtime, but a capability list exists precisely to say what is covered, and one that overstates is the same failure as a contract whose body is commented out. The new manifests claim `ssr`, `boundary-graph`, `transform`, `build`, `graph` — all of which match.

The manifest index now carries the cost model too, since this is the file where it gets decided: cost is roughly (examples × matching contracts), each manifest also brings a per-worker copy and a pooled dev server, and `fixtureSource` remains the right tool when the question is "does this one feature work" rather than "does this whole app work".

None of the four streams — all render synchronously — so `ssr-isolation` stays `pending`. Its blocker is unchanged and now better bounded: what it needs is not another SSR example but a _streaming_ one.
