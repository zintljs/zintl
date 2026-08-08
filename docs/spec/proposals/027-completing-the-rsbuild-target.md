# Proposal 027: Completing the Rsbuild Target

**Status**: IN PROGRESS — §2.3(c) closed, see [027-leak-ledger.md](027-leak-ledger.md).
**Date**: 2026-08-06
**Ledger**: [027-leak-ledger.md](027-leak-ledger.md) — findings from this proposal's work, continuing 026's numbering from L-020.
**Depends on**: [026-rsbuild-as-falsification-harness.md](026-rsbuild-as-falsification-harness.md) §11, and the findings in [026-leak-ledger.md](026-leak-ledger.md). Read 026 §11 first — this document assumes its outcome and does not restate it.

## 0. What this is, and how it differs from 026

026 was a **method** proposal. It borrowed a second bundler to falsify a claim, and its deliverable was a ledger — Rsbuild support was explicitly _not_ the goal, and §11 recommended keeping it a harness.

This one is the opposite shape. It is a **completion** proposal: the remaining work 026 named but deliberately did not do, plus the decision 026 declined to take. It exists because that decision has now been taken — Rsbuild is to become a real example, sitting alongside the others.

That reverses 026 §11's recommendation, and the reversal should be legible rather than silent. 026 said _"promote it when someone asks with a real application"_, and its objections were specific and technical rather than a general reluctance. **This document's job is to turn those objections into work items, not to argue with them.** Where an objection cannot be met, §5 says so and proposes what to ship instead.

## 1. What "done" means here

Four leaks remain open from 026, and one decision is outstanding. Done is:

1. **L-004** — `\0` recognition in core no longer survives by coincidence.
2. **L-005** — asset emission on a host with no reference-id contract, reproduced and resolved.
3. **L-019** — `<html dir>` follows the locale on every host.
4. **The HMR ordering defect** — diagnosed to a cause, not just to a symptom.
5. **Rsbuild apps live in `examples/`**, are registered as manifests, and are covered by every contract whose capabilities they honestly satisfy.

Item 5 depends on 3 and 4. Items 1 and 2 do not block it and can be sequenced independently. §2.5 is not a sixth item — it is a design constraint that shapes item 3 and everything after it.

## 2. The four open leaks

### 2.1 L-004 — `\0` recognition survives on a coincidence

Core tests `id.startsWith("\0")` at seven sites to decide whether a module is one of Zintl's own. On Rspack that test is **false** for virtual modules, because unplugin materialises them as real files. Nothing has broken, because an adjacent `id.includes("node_modules")` test happens to be true — unplugin's virtual filesystem lives under `node_modules/.virtual/`.

**Verified masked; not verified correct.** It breaks the day unplugin relocates that directory, and it will break silently: Zintl would begin extracting strings from its own generated catalogs.

**The work.** `BundlerFacet` gains `isVirtualId(id)`, and the seven core sites ask it instead of testing for a byte. Note the asymmetry this closes: `resolveVirtualPath` already exists to _construct_ virtual ids, and core recognises them through no facet at all — construction is abstracted, recognition is not. Worth checking whether `resolveVirtualPath` should be retired in favour of the pair, since `viteFacet` implements it as `id => id` and the `\0` is added by the plugin, so it does not currently do what its documentation says.

**Risk**: low. Behaviour-preserving on Vite by construction, and the composition golden files make any facet-surface change visible.

### 2.2 L-005 — `emitFile` with no reference id

Rspack's `emitFile` returns `undefined`, so `import.meta.ROLLUP_FILE_URL_<id>` has no counterpart. Zintl depends on that contract twice, in asset localisation.

**Still unreproduced**, and the reason is precise rather than an excuse: both call sites sit behind multiplex, which 026 §7 excluded. So the first task is not a fix but a **reproduction** — a fixture that reaches those branches on Rspack.

**Then a triage that 026 could not make**: a `BundlerFacet.emitAsset` returning a URL-or-handle abstraction (bucket 1), versus the compiler owning output naming so a stable path can be emitted without asking the host for one (bucket 2). L-009's resolution is evidence for the second — that was also an identity problem solved by not asking the host — but the cases differ, because an emitted asset genuinely needs a URL the host will honour.

**Risk**: medium, and mostly unknown until reproduced. Budget the reproduction separately from the fix.

### 2.3 L-019 — `<html dir>` on non-Vite hosts

`lang` is fixed: the store sets it directly when no HTML projection is installed. `dir` is not, and it blocks the `rtl` capability, which blocks `locale-switch`.

026 attempted the obvious wiring — Rsbuild's `api.modifyHTML` has the same signature as `compiler.transformHtml` — and reverted it after three layers of failure. That attempt is the most valuable input here, so it is worth restating what it cost:

- Passing Rsbuild's `filename` (the **output** name) where Vite passes an absolute **source** path blanked the page.
- Fixing that got `lang` working and left `dir` failing.
- Adding the HTML catalog that `dir` needs then destabilised `lang` again — a catalog changes which code path owns the document, and the projection took over from the runtime fallback without finishing the job.
- Throughout, `__zintl_current_instance` was absent on this host, so every diagnosis read `settle beacon: ABSENT` on pages that were translating correctly.

**Three distinct pieces of work, and they should not be attempted as one:**

**(a) An HTML transform seam that is not `transformIndexHtml`.** The hook exists in the `vite: {}` block, which unplugin drops everywhere else. What is needed is a host-neutral contract — most likely a `BundlerFacet.transformHtml` the plugin routes to, with each host's entry point supplying the wiring. The signature is already agreed by both hosts; the disagreement is over _when_ it fires and _what identity_ the document has. It is also where §2.5's layering question stops being theoretical, since the Rsbuild hook is Rsbuild's rather than Rspack's.

**(b) A home for per-locale direction.** ~~Direction currently lives in HTML catalogs, read at build time by the projection.~~ **LANDED — mechanism complete, and the framing here was off in two ways.** The runtime has no table and should not grow a hardcoded list of RTL languages. Options: hand the direction map to the runtime the way `sourceLocale` is handed over today (a build-time substitution in `getRuntimeCode`), or keep it in the projection and accept that `dir` requires HTML transformation on every host. **Prefer the first** — it makes `dir` work wherever `lang` already does, and direction is a property of the locale rather than of the document.

> _First: there was no list to invent._ Direction is authored data, written into every HTML catalog unconditionally, so the item was a **hoist** — `ContentFacet.rtlLocales`, unioned by `getRtlLocales()`, substituted as `__ZINTL_RTL_LOCALES__`. Not the `sourceLocale` mechanism, which turned out to be a fragile regex over a class-field default **and** entirely dead; both are now deleted.
>
> _Second: it does not make `dir` work wherever `lang` does — not yet, and (a) is why._ On Rsbuild the direction map comes out **empty**, because the document→boundary link is a `<script src>` tag that an Rsbuild template deliberately does not have ([L-021](027-leak-ledger.md)). §4's coupling of (a) and (b) was therefore right, for a reason written down nowhere until now.
>
> Two defects on the **Vite** path were fixed on the way, and together they explain 026's unexplained third layer: the projection guarded `dir` behind a check on `lang`, and the store's attribute handling was an `else` the projection could claim without discharging.

**(c) Host-independent dev globals.** ~~`__zintl_current_instance` and the settle beacon are published on a path that does not run on Rspack.~~ **CLOSED — and the diagnosis above was wrong in both halves.** A probe run before any code was written found `__zintl_current_instance` **present** all along, and the beacon absent for an unrelated reason: Rsbuild leaves Rspack's `mode` at `"none"` in every action, so L-018's dev detection never fired and `__ZINTL_DEV__` folded to `false`. Fixed by asking the layer that owns the fact — `api.context.action`, through an `rsbuild` block on the plugin. See [L-020](027-leak-ledger.md).

**Do (c) first.** It is the smallest, it is a prerequisite for trusting any diagnosis, and 026 lost time to its absence repeatedly. — _Held up: it was one probe, it closed the item, and it corrected a 026 ledger entry on the way. It also delivered §2.5's answer early: the first genuine Rsbuild-level concern turned out to be dev-detection rather than HTML, and it needed no facet change and no `hostChain`, because the concern lives in the plugin's escape hatch. The `rsbuild` block it created is the same one (a) will hang `modifyHTML` off._

### 2.4 The HMR ordering defect

`hmr-hammer` on `react-basic` loses one hot-update event in roughly eight full-suite runs at `maxWorkers: 4`. Diagnosed as far as _"four packets for five writes; every delivered update applied"_ — so the loss is **upstream of delivery**, and every mechanism downstream of it has been cleared.

026 cleared two candidates: `isWritingFile` is exact-path and holds only compiler-written files, and `runFlush` already guards the ABA case with `adoptedRevisions`. One candidate remains unexamined, and it is Zintl's own code: [`hooks/hmr.ts`](../../../packages/zintl/src/hooks/hmr.ts) mutates Vite's `fileToModulesMap` and reassigns `mod.file`, matching modules to boundaries with loose `endsWith` comparisons. If that ever repoints a module away from the file it belongs to, the next edit to that file yields `modules: []`, the hook returns it unchanged, and Vite sends nothing — which is exactly the observed symptom.

**This is a hypothesis, not a finding**, and it must not be fixed as though it were one. The work is:

1. **Instrument first.** Record, at failure time, the hook invocation count, Vite's `modules.length` per invocation, and every `mod.file` reassignment. The expensive part of this bug is reproduction; the diagnosis is cheap once it fires.
2. **Then decide.** If the repointing is the cause, the question is whether that block should exist at all — it is the most bundler-internal code in the repository and has no analogue on any other host.

This is ZDB / proposal 024 territory rather than 026's, and it is the one item here that could plausibly be a larger project than it looks.

**Sequencing note**: this blocks item 5 only in the sense that an example with broken HMR is not an example. If the fix proves large, §5's fallback applies.

### 2.5 A constraint the above runs into: what a bundler facet is _of_

Not a fifth work item — a design question that shapes §2.3 and anything after it, recorded so it is not re-derived.

**Why there is an `rspackFacet` and no `rsbuildFacet`.** Mechanically, one could not activate: unplugin's Rspack build context hardcodes `framework: "rspack"` (`context-D3KUBasH.mjs`), and the Rsbuild adapter delegates to `getRspackPluginFromRaw`, so `nativeHostView` reads `"rspack"` even under Rsbuild.

But the principled reason is the one that matters. All three `BundlerFacet` hooks — virtual id spelling, dynamic-import syntax, HMR API — are **module-system** concerns, and **Rspack owns all three**. Rsbuild is a configuration, dev-server and HTML layer on top of it and changes none of them. One facet, named for the layer that owns the behaviour.

**§2.3 is what changes that.** `api.modifyHTML` is _Rsbuild's_ API; raw Rspack uses `html-webpack-plugin`. So the moment an HTML transform hook exists there is a genuine Rsbuild-level concern, and the two facets would need to compose — which 026 §10 anticipated in those words: _"an Rsbuild facet subsuming a generic-Rspack facet."_ Whether that is supersession or plain composition is a §2.3 decision, not a settled one: Rsbuild _adds_ HTML behaviour rather than replacing Rspack's module behaviour, so plain composition looks more likely than the word "subsuming" implies.

**The same seam exists on the Vite side, and it is latent rather than theoretical.** `viteFacet` already mixes two layers:

| Hook                                                         | Whose convention  |
| :----------------------------------------------------------- | :---------------- |
| `resolveVirtualPath`                                         | **Rollup's** `\0` |
| `dynamicImportTemplate` → `/* @vite-ignore */`               | **Vite's**        |
| `hmrInjectionCode` / `hmrSelfAcceptCode` → `import.meta.hot` | **Vite's**        |

unplugin ships a Rollup adapter, so `zintljs/rollup` is one file and one exports entry away. **The day it exists it reproduces L-012 exactly** — a plain Rollup build handed `@vite-ignore` comments and `import.meta.hot`, neither of which Rollup understands. The identical defect fixed for Rspack, sitting unfixed on the other side of the same facet. Rolldown is the same story, and Vite is migrating there regardless.

**Do not split pre-emptively.** Separating `viteFacet` into a Rollup half and a Vite half with no host that needs one without the other is the abstraction inflation §8 of 026 names, and the N=1 error §2 of 026 exists to correct. `viteFacet` is currently the shape of its only implementation, and that is _fine when it is honest about it_ — this entry is the honesty.

**The trigger is concrete**: the first host needing Rollup's conventions without Vite's, i.e. a `zintljs/rollup` or `zintljs/rolldown` entry point. The cost of splitting then is low, which is the dividend from the self-activation inversion — `provides`/`supersedes` can express the relationship and the composition golden files turn any change into a diff.

**One thing that may need to move sooner.** `FacetActivationContext.bundler` is a single string, so a stacked host has two identities and a facet can only ask about one. Harmless today because nothing needs to distinguish them; it becomes real the moment §2.3 gives Rsbuild a concern of its own. A `hostChain`, or a stack rather than a scalar, is the likely shape — but it should be designed against §2.3's actual need rather than in advance of it.

## 3. Promoting Rsbuild to `examples/`

### 3.1 What the directory means

CLAUDE.md: _"18 real apps... Not demos — the contract suite drives them through real browsers."_ Two obligations follow, and they are what promotion actually costs:

- **`vpr build:examples` builds it**, so a break blocks `vpr ci` for everyone.
- **It is something a user copies**, so anything visibly broken in it is a broken promise rather than a known gap in a fixture.

`examples/custom-facets` is already a non-app library in that directory, so the rule is not absolute — but it is honestly a _different kind of thing_, and an Rsbuild app that looks like an app while lacking hot updates does not have that excuse.

### 3.2 Which examples

Start with **one**, not a matrix:

| Example       | Shape       | Rationale                                                                                                                                 |
| :------------ | :---------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `rsbuild-spa` | vanilla SPA | Promote the existing fixture. Mirrors `vanilla-spa-basic`, so any difference in output is attributable to the host rather than to the app |

A second (`rsbuild-react`) is **deliberately deferred**. The value of a framework variant is testing the framework facets against a second host, and nothing in 026 suggests those are host-sensitive — the codegen facets never touch bundler APIs. Add it when there is a reason, not for symmetry. Every example costs `build:examples` time, a snapshot set, and CI minutes on every unrelated change.

### 3.3 What moves, and what has to change

The fixture at `tests/fixtures/rsbuild-spa/` becomes `examples/rsbuild-spa/`, which means it acquires the obligations of that directory:

- **`package.json` scripts** — `dev`, `build`, `preview`, matching its neighbours. `dev` must actually work, which is what §2.3 and §2.4 are for.
- **A `tsconfig.json`**, since type-aware lint covers `examples/`.
- **Knip and lint coverage** — the current `ignore: ["tests/fixtures/rsbuild-spa/**"]` entry in `knip.config.ts` comes out, and the app must satisfy both.
- **`dirSource()` gives way to `copiedExampleSource()`** in its manifest. `dirSource` remains useful and should stay — it is the general "checked-in directory outside `examples/`" source, and this proposal removes its only current caller, not its reason to exist.
- **An HTML catalog** (`index.html.translations.json`), which the fixture lacks and which `dir` needs.
- **The README rewritten.** It currently explains why the project is a falsification target living outside `examples/`; as an example it needs to explain what it demonstrates and what is not yet supported.

### 3.4 Manifests

`tests/manifests/rsbuild-spa.ts` already exists and stays, with three changes: `copiedExampleSource("rsbuild-spa")` as its source, and its capability list widened as the blockers clear.

**Capabilities must be earned, one at a time.** The manifest's current list is `["build", "graph", "transform", "spa"]`, and every entry on it was added only after the corresponding contract passed. That discipline is the reason the suite has not accumulated skipped tests, and it should survive promotion:

| Capability                                     | Unblocked by                                               | Contracts gained                                                  |
| :--------------------------------------------- | :--------------------------------------------------------- | :---------------------------------------------------------------- |
| `locale-switch`, `rtl`                         | §2.3 (`dir`)                                               | `locale-switch`, and with `locale-switch-stress`, `locale-storm`  |
| `hmr`                                          | §2.4, plus a Tier 2 decision under ZDB §7a                 | `hmr`, `delivery-failure`, `delivery-ordering`, `syntax-recovery` |
| `assets`                                       | already satisfiable — the fixture localizes a `.txt` today | `assets`                                                          |
| `boundary-graph`                               | already satisfiable                                        | `boundary-graph`                                                  |
| `memory`, `performance`, `hmr-stress`, `chaos` | after `hmr`                                                | the stress and chaos contracts                                    |

**`assets` and `boundary-graph` are claimable now** and should be added before promotion rather than after — they are free coverage and they exercise the L-009 fix in a browser rather than only in a snapshot.

**`hmr` is not a checkbox.** ZDB §7a makes dev support conditional on two load-bearing properties: a monotonic non-repeating per-event sequence, and `read()` returning _that event's_ content. Neither has been established on Rspack. Establishing them is a prerequisite for the capability, and if they cannot be established, §5 applies.

### 3.5 CI

Promotion adds an app to `vpr build:examples` and contract cases to `vpr ci`. Both are wanted — that is the point of promoting — but two things should be checked rather than assumed:

- **Wall clock.** `ready:examples` is already the long gate. Measure before and after; if an Rspack build materially lengthens it, that is a fact worth knowing before it becomes a habit.
- **The 4-worker failure rate.** §2.4 is unresolved, and adding a project adds contention. Re-measure the baseline established in 026 (2 failures in 3 runs before the fixture-race fix, 1 in 8 after) so any regression is attributable.

## 4. Sequencing

```
(c) host-independent dev globals        ← do first; everything else debugs through it
      ↓
2.3 (a) HTML transform seam  +  (b) direction's home
      ↓
locale-switch / rtl capabilities
      ↓                                  2.4 HMR diagnosis ──→ hmr capability
3.3 promote to examples/  ←──────────────┘
      ↓
assets + boundary-graph capabilities   ← claimable earlier; do them whenever

2.1 L-004 isVirtualId       ─ independent, any time
2.2 L-005 reproduce + triage ─ independent, budget reproduction separately
```

The only hard ordering is that dev globals precede everything (they make diagnosis trustworthy), and that promotion follows `dir` and the HMR decision.

## 5. If the HMR work does not land

Named in advance so it is a decision rather than a slide.

If §2.4 proves larger than expected, or ZDB §7a's two properties cannot be established on Rspack, then **promote anyway, with the gap stated in the app itself**: a README and a `dev` script that says plainly that hot updates are not supported on this host yet, and a manifest that does not claim `hmr`.

That is defensible — a production-build-only example is still a real example, and Zintl's value proposition is a build-time one. What is _not_ defensible is a `dev` script that starts a server and silently never updates, which is what shipping today would do. **The failure mode to avoid is not "incomplete", it is "quietly wrong".**

## 6. What this proposal does not cover

- **SSR on Rspack.** Untouched by 026 and unexamined. A separate proposal.
- **MPA / HTML fan-out.** §2.3 covers the HTML _seam_, not the multiplex fan-out that 026 §7 excluded and that L-005 sits behind.
- **webpack.** ~90% of Rspack findings transfer, but nothing here validates that, and claiming it without a run would be exactly the N=1 error 026 exists to correct.
- **Making Rsbuild a _supported_ target.** Promoting an example is not the same as promising support. That is a third decision, and it should be taken with the same explicitness as this one.
