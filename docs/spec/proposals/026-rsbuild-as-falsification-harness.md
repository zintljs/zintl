# Proposal 026: Rsbuild as a Falsification Harness

**Status**: OPEN — method proposed, no work started, no code written.
**Date**: 2026-08-05
**Kind**: Method proposal. This one is different from its neighbours — see §0.
**Depends on**: the faceted compiler architecture (CLAUDE.md, "Faceted compiler architecture"), the contract-test layer (`tests/contracts/`), and the Unplugin migration already landed in `packages/zintl`.

## 0. How to read this — and why it looks unlike the others

Every other document in this folder describes something **inside** the system: a defect, a refactor, a subsystem to build. This one describes a **way of working**, and it points outward — at a build tool we do not support, in order to learn things about our own code that cannot be learned from inside it.

So read it differently:

- There is **no patch to apply here.** The deliverable of the work this proposal authorises is a _ledger of discovered leaks_ and a _revised facet contract_ — not Rsbuild support.
- The sections that matter most are **§5 (the working loop)** and **§6 (verify the world before you trust it)**. §1–§4 are justification; you can disagree with them and still run §5 correctly.
- The instructions in §6 are deliberately obvious. They are written down because they are the ones most likely to be skipped by someone (or something) confident enough to skip them, and skipping them poisons every conclusion downstream.

If you are picking this up cold: read §1, §3, §5, §6, then §8's guardrails. Then go read `packages/zintl/src/hooks/resolve.ts` in full — it is the single best illustration of the problem and you will not feel the shape of this work until you have.

## 1. The problem this is trying to solve

Zintl was designed for Vite and grew a faceted architecture so that frameworks and toolchains could be composed rather than hardcoded. The facet work is real and it landed. But the system still carries a large, **undocumented population of Vite-shaped assumptions** that the facet layer never touched — because nothing in the repository has ever disagreed with them.

They are not marked. They do not look wrong. They look like this (`packages/zintl/src/hooks/resolve.ts:157-160`):

```ts
const isEligible =
  !ext ||
  ["js", "jsx", "ts", "tsx", "md", "txt", "vue", "svelte"].includes(ext) ||
  (ctx.compiler.assets as AssetManager).isSupportedAsset(cleanId);
```

Read in isolation this is a perfectly sensible line. It is also: app-agnostic (a Vue-only app pays for `.svelte`; a Svelte app that adds a new templating extension gets silently skipped), facet-blind (the active facets know exactly which extensions they claim, and are not asked), and — see §4 — arguably an answer to the wrong question entirely.

**We cannot find the rest of these by inspection.** That has been attempted as a routine and it under-delivers, for a structural reason: an assumption is only visible as an assumption once something violates it. Grepping for "hardcoded things" finds the ugly ones; the dangerous ones are the ones that read as obviously correct.

## 2. The method: falsification, not audit

Introduce an environment in which the wrong assumptions **fail**, and let the failures write the refactor list.

This is the entire idea. We are not adding a build tool because we want that build tool (yet). We are adding one because our architecture makes a claim — _"the compiler is bundler-agnostic; Vite is merely the only integration today"_ — and that claim is currently **unfalsifiable**. It has never been tested against anything that could disprove it. An abstraction validated at N=1 is not an abstraction; it is the shape of its only implementation, written down twice.

The corollary matters for sequencing: this work must happen **before** we freeze the facet authoring contract (including the self-activation inversion — facets deciding for themselves when they apply, rather than core mapping deps to facets). Whatever the spike teaches about the facet contract should land _in_ that contract, not be retrofitted after third parties have written facets against it.

### 2.1 Why now, at alpha

Deliberately, and this is the strongest argument in the document:

Feature work gets **cheaper** to defer — waiting teaches you what users actually want. Architectural inversions get **monotonically more expensive** — every day of deferral adds consumers to migrate. The facet authoring API becomes a public API the moment someone outside this repo writes a facet against it. Today, changing it costs a commit. After adoption it costs a migration guide, a deprecation window, and a compatibility shim we maintain for a year.

Alpha, with the facet contract not yet frozen, is the only window in which this is free. We are in it.

The counterweight, stated honestly so nobody has to discover it the hard way: what kills a project at this stage is not a slightly-too-centralised resolver — it is spending the entire alpha window on internal elegance for a tool nobody has installed. **This work is timeboxed (§7). Ship the findings, then go get users on Vite.**

## 3. Why Rsbuild

The selection criterion is **not** market share. It is: _maximally different from Rollup, while still capable of expressing what Zintl does._ Two failure modes bracket the choice.

**Same-family targets validate nothing.** Rolldown is the obvious trap — Vite is migrating there anyway, the plugin context is Rollup's, `\0` works, `this.resolve` works, `emitFile` works. We would pass on day one and learn zero. Farm is a milder version of the same trap: its plugin API is deliberately accommodating of Vite-shaped plugins, which is exactly what makes it useless as a forcing function.

**Different-but-incapable targets teach nothing actionable.** esbuild would break everything, but most breaks would be _unfixable_ rather than instructive: no recursive resolve, no emit hook, `metafile` is read-only and post-hoc, no meaningful control over chunking. The finding would be "esbuild cannot host Zintl's core value proposition," which we already suspect and which produces no refactor. Bun's bundler is the same story today — its plugin API is esbuild-shaped and thin, and its splitting is primitive.

**Turbopack** has no public plugin API. Ruled out on availability, not merit.

**Rspack** sits in the gap. It is a genuinely foreign mental model — loaders and `Compilation` hooks instead of a Rollup plugin context, `splitChunks` instead of `manualChunks`, no `\0` virtual convention, no `import.meta.ROLLUP_FILE_URL_*`, no `this.resolve(..., { skipSelf: true })`, HTML supplied by a plugin rather than treated as a module graph entry, `module.hot` rather than `import.meta.hot`. And critically, it **exposes a real chunk graph you can inspect and influence.** Zintl's entire thesis is catalogs aligned to the bundler's own code splitting; Rspack is the only non-Rollup target where that thesis is even _expressible_.

Use **Rsbuild**, not raw Rspack, for the example app. Raw Rspack is a bundler configuration; Rsbuild is the honest Vite peer — dev server, HMR, framework plugins, HTML handling, SSR. We want an apples-to-apples application, not a hand-tuned webpack config that lets us quietly route around every problem we are trying to find.

Secondary benefit, and it is not small: Rspack is webpack-API-compatible. Most of what we learn transfers to classic webpack, which is the Next.js-shaped ecosystem. That is a later conversation, but it is the reason this particular door is worth opening first.

### 3.1 Sequencing of other targets

Recorded so the ordering is a decision and not an accident:

| Target             | Verdict for _this_ phase | Why                                                                        |
| :----------------- | :----------------------- | :------------------------------------------------------------------------- |
| **Rsbuild/Rspack** | **Selected**             | Foreign model, capable chunk graph, webpack lineage                        |
| Rolldown           | Rejected as a harness    | Same family — validates nothing. Will arrive via Vite regardless           |
| Farm               | Deferred                 | Plugin API too Vite-accommodating to break us; revisit as a support target |
| Bun                | Deferred, **intended**   | Community deserves it; bundler API not yet expressive enough for the core  |
| esbuild            | Rejected                 | Breaks everything, fixes nothing — no chunk control, no emit hook          |
| webpack (classic)  | Follows Rspack for free  | ~90% of Rspack findings transfer                                           |
| Turbopack          | Blocked                  | No public plugin API                                                       |

Bun is explicitly on the roadmap and explicitly not first. It is not a capability judgement about Bun as a runtime — it is that a falsification harness must be able to _host the thing being falsified_, and today Bun's bundler cannot express chunk-aligned catalog emission. Revisit after Farm, or sooner if Bun's bundler plugin API grows chunk-graph access.

## 4. What we already know is Vite-shaped

This inventory was compiled from **`packages/zintl/src/hooks/resolve.ts` alone**. The rest of the plugin, and the compiler's managers, have _not_ been audited for this document. Treat it as a starting sample, not a complete list — the spike exists precisely because the complete list cannot be written in advance.

| Assumption                                        | Where it shows up                                     | Rspack reality                                                       |
| :------------------------------------------------ | :---------------------------------------------------- | :------------------------------------------------------------------- |
| `\0` null-byte virtual module convention          | every virtual prefix in `resolveIdHook`               | not a thing; needs a virtual-modules mechanism with different ids    |
| `this.resolve(id, importer, { skipSelf: true })`  | multiplex propagation, translation-neutrality probing | **no equivalent** — this is the deepest coupling                     |
| `this.emitFile` + `import.meta.ROLLUP_FILE_URL_*` | asset localisation in `loadHook`                      | different emission model entirely                                    |
| `this.addWatchFile`                               | throughout `loadHook`                                 | analogue exists, different semantics                                 |
| Query-string ids (`?zintl-multiplex=fr`)          | the whole multiplex strategy                          | expressible via `resourceQuery`, but module identity/caching differs |
| `this.environment.config.consumer === "server"`   | `resolveIdHook` / `loadHook` SSR detection            | Vite 6 Environment API — no counterpart                              |
| HTML as a module graph entry                      | the `.html` fan-out branches                          | HTML comes from a plugin, not the graph                              |
| `import.meta.hot`                                 | generated dev code                                    | `module.hot`                                                         |
| Static extension allow-list                       | `resolve.ts:157-160`                                  | wrong for _any_ app, including Vite ones                             |

### 4.1 The reframe this will probably force

Worth stating up front, because it changes what you are looking for and it is easy to miss while triaging line by line.

`resolveIdHook` currently implements **multiplex propagation as a graph traversal delegated to the bundler's resolver** — one `resolveId` call per edge, walking outward as the bundler discovers modules. But twenty lines below the extension allow-list, the same function reaches into `metadataGraph`, `dependencyGraph` and `internalManifest` to decide translation-neutrality. That is the tell: **the compiler already owns a graph that knows the answer**, and the resolver is guessing about files it has not analysed while simultaneously consulting the structure that could tell it.

The portable shape is: the compiler computes the multiplex plan from its own graph; the bundler facet only _applies_ the id rewrites the plan dictates. Under that shape, the extension allow-list does not get relocated into a facet — it **disappears**, because the question stops being "might this file contain strings" and becomes "does my graph place this module inside a translated boundary."

Rspack forces this question rather than merely inviting it, because `this.resolve(..., { skipSelf: true })` genuinely does not exist there. The current strategy cannot be ported. That is the single most valuable thing this spike is likely to produce.

### 4.2 Triage has three buckets, not two

When a leak is found, the available verdicts are:

1. **Facet it** — the knowledge is real and framework/tool-specific; it belongs in the facet that owns it. (A hardcoded React detail _inside_ the React facet is correct and good.)
2. **Relocate it** — the knowledge belongs to the compiler's graph, not to any bundler integration. §4.1 is the archetype.
3. **Delete the guess** — the code is answering a question that should never have been asked at that layer.

Bucket 3 will be correct more often than expected, and a refactor pass framed as "move hardcoded things into facets" will systematically fail to find it, because a facet-shaped answer is always available. **Record the bucket for every leak in the ledger.** A ledger where nothing landed in bucket 3 is evidence the triage was lazy, not evidence the code was clean.

## 5. The working loop

This is the flow. It is not a checklist to complete once; it is a cycle to run until the timebox or the exit criteria (§7) are hit.

```
  pick smallest failing thing
        ↓
  trace to the assumption (not the symptom)
        ↓
  triage → facet / relocate / delete        [§4.2]
        ↓
  land the fix on the Vite path FIRST
        ↓
  re-run vpr verify + vpr ready:examples    [Vite must not regress]
        ↓
  re-run the Rsbuild contract subset
        ↓
  record in the ledger, loop
```

Five rules that make the loop produce knowledge instead of noise:

**5.1 — Every fix lands on the Vite path first.** The Rsbuild example is a detector, not a customer. If a change cannot be expressed as an improvement to the existing Vite integration, it is not a fix, it is a fork. `vpr verify` and `vpr ready:examples` are the gate on every single step, not a phase at the end. A green Rsbuild with a regressed Vite is a total failure of this exercise.

**5.2 — Trace to the assumption, never patch the symptom.** The temptation on every leak is a conditional: `if (bundler === "rspack") { ... }`. That is precisely the disease this proposal exists to treat, and it will look like progress. The question is always: _what did this code believe, and who should have told it?_

**5.3 — Point the contract suite at it, not just the build.** Breakage-driven discovery only finds what breaks _loudly_. Plenty of assumptions will "work" on Rspack in a degraded way — over-included locales, chunk boundaries that do not line up, a catalog that loads but is larger than it should be. None of those throw.

The contract layer is already the right instrument and is, of all our architecture, the part that most anticipated this moment: contracts declare `requires: Capability[]` and never name an app. Add a bundler dimension to the capability set, register one Rsbuild project in the manifest, and run the **existing** contracts against it. Per-tool quirks go in an adapter, never in a contract. Do not write Rsbuild-specific tests; if a contract needs to know which bundler it is running under, that is a finding to record, not a parameter to add.

**5.4 — No retries, still.** The suite runs `retry: 0` on purpose (CLAUDE.md, "Testing architecture"). Under a new bundler the temptation to write off a failure as environmental will be much stronger and will be wrong just as often. A flake here is a report about a real ordering or lifecycle difference, and it is exactly the kind of finding this exercise is for.

**5.5 — Write the ledger as you go, not at the end.** One entry per leak: what failed, the assumption behind it, the bucket (§4.2), the fix, and whether the facet contract had to change to express it. The accumulated "facet contract had to change" entries _are_ the revised facet authoring API, and reconstructing them from a diff afterwards is exactly the expensive thing this folder exists to prevent.

The ledger lives in [026-leak-ledger.md](026-leak-ledger.md).

## 6. Verify the world before you trust it

Obvious. Written down anyway, because these are the steps that get skipped by whoever is most confident, and because every conclusion in §5 is worthless if the API surface being tested against is imagined.

**6.1 — Your knowledge of these tools is stale. Assume it.** Rspack, Rsbuild and Unplugin move fast. Anyone picking this up — human or model — carries a mental model with a cutoff date, and Rspack in particular has changed plugin, HTML and chunking surfaces between minor versions. Do not write a line of integration code from memory, and do not trust a blog post, a tutorial, or a previously-working snippet from another project.

**6.2 — Read the shipped types, not the documentation.** After installing, read the `.d.ts` files in `node_modules/@rspack/core` and `node_modules/@rsbuild/core`. Documentation lags; the type definitions in the installed version are the contract you are actually coding against. Same for Unplugin: read its source to establish **which hooks it genuinely normalises for the Rspack target and which it silently no-ops**. This is the highest-value hour of the entire exercise. Unplugin's normalisation is not uniform across targets, and assuming it is will produce an integration that appears to work and quietly does nothing.

**6.3 — Re-verify our own end too.** Check the current Vite version's API before concluding that something we do is "the Vite way." Some of what looks like a deep Vite coupling may be an obsolete Vite pattern we never migrated — the Environment API usage in `resolve.ts` is worth checking against current Vite specifically. A leak that turns out to be _our own staleness_ is still a finding, and a cheaper one.

**6.4 — Pin exact versions and record them here.** Add a table to this document — tool, exact version, date checked — and update it on every resume. A finding without a version attached is not reproducible, and "this doesn't work on Rspack" ages into a lie the moment Rspack ships a minor.

| Tool            | Version  | Date checked | Notes                                                                                                          |
| :-------------- | :------- | :----------- | :------------------------------------------------------------------------------------------------------------- |
| `@rsbuild/core` | `2.1.10` | 2026-08-05   | Pulls `@rspack/core` itself (`~2.1.8`). Programmatic API: `createRsbuild()` + `loadConfig()`                   |
| `@rspack/core`  | `2.1.8`  | 2026-08-05   | Transitive via `@rsbuild/core`, not pinned directly                                                            |
| `unplugin`      | `3.3.0`  | 2026-08-05   | Already a `zintljs` dependency. Rspack + Rsbuild targets present but never exercised before this spike         |
| `vite`          | `8.1.5`  | 2026-08-05   | **Aliased**: `pnpm-workspace.yaml` maps `vite` → `npm:@voidzero-dev/vite-plus-core@0.2.7`, which wraps `8.1.5` |

The `vite` row is itself a §6.3 finding. Our peer range is `^6.0.0 || ^7.0.0 || ^8.0.0`, but nothing in this repo is built or tested against stock Vite — the resolved package is Vite+ core. "The Vite way" here means "the Vite+ 0.2.7 way", and any conclusion about a Vite coupling should say which of the two it was checked against.

**6.5 — Prove the harness before blaming the system.** Get a trivial hello-world Unplugin plugin — one `transform`, one virtual module, one emitted asset — running under Rsbuild _before_ pointing Zintl at it. Without that baseline, every early failure is ambiguous between "Zintl is Vite-coupled" (the finding we want) and "we are holding Rsbuild wrong" (noise). Half a day here saves a week of misattributed traces.

**6.6 — Note what you could not verify.** Following house style (see 025 §6): if a conclusion is inferred rather than reproduced, mark it. A confident wrong entry in the ledger costs more than an honest gap, because the next person will build on it.

## 7. Scope, timebox, and exit criteria

**Scope — deliberately minimal.** One SPA example: vanilla or the react-basic equivalent. **No SSR. No MPA, and specifically no HTML fan-out** — that path (HTML-as-module, locale-directory rewriting, script-src injection) has the thickest Vite-specific surface in the codebase and will drown the signal in problems we already know about. Get a trivial app through a _subset_ of contracts. The leak list from that is the honest one; the leak list from an ambitious first target is mostly noise about HTML.

**Timebox.** Treat this as a spike measured in days, not weeks. If it has not produced a usable ledger inside the box, stop and write up what it did produce — a documented failure to integrate is itself a finding about the facet architecture, and a valuable one.

**Definition of done for this phase** — note that "Rsbuild works" is not on the list:

1. A **leak ledger**: every assumption found, its bucket, its fix or its deferral.
2. A **revised facet authoring contract**, informed by the leaks — the input to the self-activation inversion, which should not be frozen before this exists.
3. A recommendation on **whether Rsbuild becomes a supported target**, with the cost of doing so.
4. `vpr ci` green on the Vite path, unchanged in behaviour and not weakened in coverage.

**Exit criteria — stop early if:** the integration requires a second parallel code path in the compiler rather than a facet (that is a finding: our seam is in the wrong place, and forcing it produces a fork); or three consecutive leaks all land in "facet the difference" with no structural insight (the harness has stopped teaching, bank the ledger and go).

## 8. Guardrails — how this goes wrong

Named in advance so they are recognisable from inside, where they always look reasonable.

- **The fork.** Rspack-specific branches accumulate in shared code and we ship two integrations wearing one name. Detection: any `if (bundler === ...)` outside a facet.
- **Vite regression by neglect.** The new target gets attention, the working one drifts. Detection: §5.1's gate, run every step, not at the end.
- **Abstraction inflation.** Every difference becomes a facet capability until adding a feature requires touching four facets and nobody can answer "what happens for a React SSR app" without running it. Suggested guard, cheap given we already have 18 examples: **snapshot the resolved capability set per example app as a golden file**, so composition stays inspectable as a flat artifact and any change that silently alters what react-ssr resolves to shows up as a diff.
- **Scope drift into support.** "While we're here" turns a spike into a shipped target with an implied maintenance commitment and a second CI matrix. §7's definition of done exists to make that a decision rather than a slide.
- **The ledger written from memory at the end.** See §5.5. This is the most likely failure and the least dramatic.

## 9. Open questions

1. Does the contract capability set need a genuine `bundler:*` dimension, or does the existing capability model already cover it without extension? Answering this is itself a test of the capability model.
2. Can the multiplex plan (§4.1) be computed entirely from the compiler graph ahead of resolution, or does it have a genuine dependency on bundler-discovered modules that no static graph can supply? If the latter, the whole portability claim needs re-examining, and that would be the most important finding available here.
3. Is Rsbuild's HTML handling close enough to model as a facet, or does the MPA/fan-out path need a fundamentally different design per bundler? Deliberately out of scope for the spike (§7), but the spike may produce evidence either way — record it if so.
4. Does the self-activation inversion need a detection context rich enough to see the bundler itself, and if so, what does a facet get to ask about its host?

## 10. Relationship to the facet self-activation work

Recorded because the ordering is the whole point and would otherwise be lost.

The planned inversion — facets deciding for themselves when they apply, instead of core mapping dependencies to facets — is a good move and should happen. But it **freezes the facet authoring API**, and this spike is the only thing that can tell us whether that API is expressive enough for a bundler that is not Rollup-shaped.

Do the spike first. Let the leaks specify the contract. Then invert.

Two constraints the inversion will need regardless, surfaced by thinking about this ordering and worth carrying into that design:

- **Self-activation collides with first-contributor-wins.** Function-hook resolution is order-dependent; today the order is a readable list in core. Once facets self-select, registration order becomes both semantically meaningful and invisible. Resolve by sorting on **declared specificity**, not on who fired first.
- **Activation is not a boolean.** Real conditions involve supersession — a Next facet subsuming a React facet, an Rsbuild facet subsuming a generic-Rspack facet. Independent predicates cannot express "I supersede you." Facets will need `provides` / `supersedes` / `conflicts` declarations and a small resolution pass, plus a resolution trace so "why is this facet on?" stays answerable. Distributed activation without an explain path is worse than the central switch it replaces.
