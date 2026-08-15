---
"zintljs": minor
"@zintljs/compiler": minor
"@zintljs/testing": patch
---

Fix Vue on Rsbuild, and rebuild the Rsbuild examples as `create-rsbuild` starters across all four frameworks.

**The fix.** Vue on Rsbuild built green and shipped the source locale. Extraction, catalog scaffolding, `verifyIntegrity`, chunk alignment and the HTML projection were all correct — only the code generation was missing, so a page rendered English under a Spanish `<title>`. The cause was one skip in Zintl: `hooks/transform.ts` ignored every id containing `?vue`, which is right on Vite (that id names a virtual module holding one block of the SFC) and wrong on Rspack (`vue-loader`'s pitcher rewrites it into a request that re-reads the whole file). Zintl was transforming the parent request, which is discarded, and skipping the block requests, which become the code.

Whether a block request carries the whole file is a fact about the **bundler**, so it is now a bundler-facet declaration — `BundlerFacet.sfcBlockRequestsCarryWholeFile`, `true` on `rspackFacet`, undeclared on `viteFacet` — and `hooks/transform.ts` asks it instead of matching a query string. Vite's behaviour is unchanged by construction. Written up as L-051.

**The examples.** The two Rsbuild examples were never written to be examples: they grew out of proposal 026's falsification harness and were Vite's starter with the branding torn out, with names (`rsbuild-spa` = vanilla, `rsbuild-react` = no pattern) that did not say what they were. They are now `rsbuild-<framework>-<pattern>`, and each reads as "I ran `pnpm create rsbuild`, then added localization": the page, the CSS and the mount point are the template's, and what is added is the four-locale switcher, `?lang=`, the catalogs, and the `index.html` Zintl needs to localize `<title>` and `<html dir>`.

Renamed: `rsbuild-spa` → `rsbuild-vanilla-basic`, `rsbuild-react` → `rsbuild-react-basic`.

New, each in the contract suite with capabilities earned one contract at a time:

- **`rsbuild-vue-basic`** — the app that found L-051 and now guards the fix.
- **`rsbuild-svelte-basic`** — Svelte 5 on Rspack; it needed no Zintl change at all.
- **`rsbuild-vanilla-spa`** and **`rsbuild-vue-spa`** — a hand-rolled router and `vue-router`, each with a lazy `await import()` route, so catalog splitting on Rspack is demonstrated for a boundary the entry never imports statically.
- **`rsbuild-vanilla-mpa`** and **`rsbuild-vue-mpa`** — two `source.entry` keys, two HTML templates, and a shared component that anchors itself. The first projects on either host to drive Zintl's multi-entry HTML path, which `hooks/html.ts` was written for and nothing had run.

The support statement moves with the evidence: Rsbuild now covers all four frameworks, single-page and multi-page, in build and dev. `multiplex` and SSR remain Vite-only.

**Two limitations found on the way, both documented rather than fixed.** Vue's Options API has never worked on either host — a plain `<script>` compiles its template into a separate render function where the helpers Zintl injects are not in scope, and the render throws `_ctx._t is not a function`; every Vue example here uses `<script setup>`, which is why it had never surfaced (L-053). And an inline arrow in a Svelte event attribute on an element with extractable text makes the stitched unit start inside the attribute, producing unparsable output — also on both hosts.

Also here: the `hmr` capability is not claimed on the new projects, and the reason is measured rather than assumed — an edit to a string in a boundary the runtime has to _fetch_ loses the race with the catalog write when the page full-reloads (10 failures in 10 on Svelte, against React and vanilla passing 10 in 10 in the same batch).

Two build-snapshot stability defects were found and fixed on the way, both of which had first been read as flake. `examples/rsbuild-svelte-basic` pins Svelte's `cssHash`, whose default hashes the absolute filename and made its snapshot depend on which test worker copied the project (L-052). And `@zintljs/testing`'s `sanitizeCode` now normalises `clonedRuleSet_N`, which `VueLoaderPlugin` numbers from a module-scoped counter that accumulates across every Vue project a worker compiles (L-054).

Documentation that described Rsbuild as an unsupported falsification target has been corrected in four places, and the `18 example apps → 72 contract tests` counts, already stale, are now 27 and 199.

**The performance gate was failing on machine state, and now scales properly.** `vpr bench` had started reporting regressions that were not there: on one laptop, `Structural HMR Latency` measured 0.44 ms against a recorded 0.2139 ms and `Colony HMR Latency` 0.75 ms against 0.4124 ms — on identical code, verified by building the original commit in a worktree and running it alongside. The machine had 14 GB of 15 GB swap in use. The calibration that exists to absorb exactly that could not see it, because it was a `Math.sin` loop: it stays in L1, allocates nothing, never provokes the collector, and reported the machine 1.00× while every allocation-heavy path had halved in speed.

Four changes came out of it. The calibration workload now allocates a working set large enough to touch fresh pages, builds strings, sorts and serializes, so it degrades with the resources the benchmarks depend on — its size mattered as much as its shape, since a first attempt at 48 short-lived strings never grew the heap and so missed `Extract Long File`, which builds a large native AST, entirely. Across the suite that took normalised ratio spread from 54–121% down to 1–9%. Budgets are expressed as multiples of that calibration rather than as milliseconds plus a separate reference constant, so there is no second number to keep in step and nothing to drift apart from. The comparison moved from the mean to **p75**, after a run where `Fast-Path (No Translations/Sinks)` reported mean 0.1183 ms against p75 0.0549 ms and max 16.3 ms — two stalled iterations moved the mean by 2.2× and failed the gate while p75 sat comfortably inside it. And `vpr ready` now runs the benchmark **second**, right after the package build, instead of last: measured after 27 example builds, a type-aware lint and 800 tests, the same benchmark reads 3.4 ms where it reads 0.5 ms run early.

A budget failure now also prints the calibration reading and says to check swap before concluding the code regressed, and a missing calibration is a hard failure rather than eight meaningless violations against zero. `vpr ready` went from failing roughly every other run to four consecutive passes.
