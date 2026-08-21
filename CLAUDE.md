# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Zintl is a compile-time internationalization engine. Apps write plain string literals; the compiler extracts them, builds a dependency graph from each `zintl(locale)` call, and emits chunk-aware translation catalogs aligned with the bundler's own code splitting. No `t()` wrappers, no manually maintained key dictionaries.

This is a pnpm workspace monorepo built on **Vite+** (`vp`/`vpr` CLI, wraps Vite/Rolldown/Vitest/tsdown/Oxlint/Oxfmt). Run `vp help` / `vp <command> --help` for tool help; docs are at `node_modules/vite-plus/docs`.

Requires Node `^22.18.0 || >=24.11.0` and pnpm. `vp install` sets everything up (`prepare` runs `vp config`).

## Commands

**Build (always run before lint or tests):**

```bash
vpr build          # root script, builds packages in dependency order (--transitive)
```

Do **not** use `vp run -r build` as a substitute — it builds in parallel, so `zintljs#build` can run before `@zintljs/compiler`'s `dist` exists and fails. Only `vpr build` (or `vpr --transitive <pkg>#build`) respects package build order.

Type-aware lint resolves workspace imports through each package's `dist/*.d.mts`, and also covers `examples/`, which need their sibling packages' dists and vinext's generated `.next` types. Linting before building on a fresh checkout produces ~172 phantom "Cannot find module" errors — build first, always.

**The two verification gates:**

```bash
vpr verify         # build:examples → lint → knip → unit tests → format check   (~1 min)
vpr ready:examples # build 30 example packages → 309 contract e2e tests        (~2-5 min)
vpr ready           # verify + bench, local pre-handoff check
vpr ci              # ready + ready:examples, what CI runs
```

`vpr verify` is the fast loop. `vpr ready:examples` drives real Playwright browsers against real example apps and is what catches integration regressions — run both for anything touching the extractor, compiler, or boundary graph.

**Single package / single test:**

```bash
vpr <package_name>#<command>        # e.g. vpr @zintljs/compiler#build
vp test <dir-or-file>               # e.g. vp test packages/compiler/src/__tests__/pipeline
vp test --config=tests/vitest.config.ts   # contract suite only (also: vp run test:contracts)
```

**Other:**

```bash
vpr bench     # extraction/HMR performance budgets (NODE_OPTIONS=--expose-gc)
vpr smoke     # packs real tarballs, npm-installs outside the repo, builds against stock Vite and Rsbuild — run before releasing
vpr change    # add a changeset (say what changed and why — becomes the changelog)
```

Piping `vpr verify`/`vpr ready*` into `tail`/`grep` reports the _pipe's_ exit code, not the gate's — a failing suite can look like success. Redirect to a file and check `$?` on the command itself if you need a reliable pass/fail signal.

## Layout

| Path                 | What it is                                                                                                                                                                                                                                                                                                                             |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/zintl`     | Published as `zintljs`. Vite plugin + macro. Most users only install this.                                                                                                                                                                                                                                                             |
| `packages/compiler`  | Published as `@zintljs/compiler`. Boundary graph, chunking, ICU baking, runtime source.                                                                                                                                                                                                                                                |
| `packages/extractor` | Published as `@zintljs/extractor`. Framework-blind AST string extraction.                                                                                                                                                                                                                                                              |
| `packages/testing`   | Internal, never published. Contract-test harness (`Lab`, assertions, environment).                                                                                                                                                                                                                                                     |
| `examples/`          | 30 workspace packages — 29 real apps (React/Preact/Solid/Vue/Svelte/Lit/vanilla × SPA/SSR/MPA, on Vite and Rsbuild) plus the `custom-facets` library. Not demos — the contract suite drives them through real browsers. Every app renders the same locale bar (`docs/examples-locale-bar.md`); the page under it is its own starter's. |
| `tests/`             | Contract specs, fixtures, manifests — shared across examples.                                                                                                                                                                                                                                                                          |
| `docs/`              | User docs (`architecture.md`, `configuration.md`, `directives.md`, `icu.md`, `glossary.md`), plus `examples-locale-bar.md` — the shared UI every example renders. `docs/spec/` has internal design notes; `zrs-*` test names refer to sections of `docs/spec/ZRS.md`.                                                                  |

## Architecture

### Pipeline

```
Source Code → Extractor (Intelligent Stitching) → Compiler → Boundary Graph → Chunks → Managers → Runtime
```

- **Extractor** (`@zintljs/extractor`) reads source with an AST parser (oxc) and reports what it finds. Never modifies files, carries no framework knowledge — React/Vue/Svelte behavior arrives as configuration.
- **Compiler** (`@zintljs/compiler`) decides what belongs together: builds the boundary graph, computes entry/lazy/shared chunks, bakes ICU grammar into JS conditionals, reconciles translations across edits (Levenshtein-based), and generates runtime source.
- **Plugin + runtime** (`zintljs`) wires the compiler into Vite and into the browser. The compiler itself is bundler-agnostic — Vite is the only integration today, but nothing about the compiler assumes it.

### Boundary graph

- **Trust anchor**: a call to `zintl(locale)` — the point an app declares what language it's in. Every anchor is independent, with its own hydration lifecycle; nested anchors don't inherit from parents.
- **Entry point**: a file with a _top-level_ `zintl()` call (vs. one nested in a function).
- **Boundary**: the set of strings reachable (via imports) from one trust anchor. Becomes one catalog chunk. Identity is content-based (`b_<hash>`), not path-based, so moving/renaming files doesn't orphan translations.
- **Stitched unit**: the actual unit of extraction — template literals, JSX fragments, and HTML strings are stitched into logical pieces before extraction (not extracted as raw strings), so a sentence split across tags stays one key, and interpolations normalize to stable placeholders (`{input}`, `{inputN}`).
- What's passed to an anchor matters: a **variable** (`zintl(locale)`) ships every locale, switchable at runtime, with a catalog chunk emitted. A **literal** (`zintl("fr")`) is a build-time fact — the compiler bakes that locale in and emits no catalog chunk at all; other locales, including the source locale, are never built.

### Ghost mode & runtime splitting

- **Ghost mode**: the source locale (`sourceLocale`) is never written to disk — the compiler virtualizes it from the extraction manifest, and lazily imports it via the generated Manager only if it's the active locale.
- **Smart manager**: generated loader that inlines the anchor's locale for a fast start while keeping other locales lazy ("synchronous boost" when the loader resolves synchronously).
- Virtual modules: `virtual:zintl/content/<locale>/<boundary>` (dev), `virtual:zintl/catalog/{entry,lazy,shared}:<id>` (build).
- The reactive store is split by environment to avoid shipping unneeded code: `runtime/store-core.ts` (shared store/loader/resolver logic), `store-client.ts` (SPA popstate + `MutationObserver` locale sync, gated by the `clientLocaleSync` capability), `store-server.ts` (Node `AsyncLocalStorage` request scoping + HTML stream injection, gated by `serverRequestScope`). `getRuntimeCode()` composes the final `store.js` from resolved capabilities.

### Faceted compiler architecture

Framework and toolchain behavior (React/Vue/Svelte, SSR, Vite, client-SPA, etc.) is composed from discrete **facets** rather than scattered conditionals — each facet owns one orthogonal concern. Array/boolean capabilities merge via union; function hooks are first-contributor-wins with conflict detection (two facets claiming the same file extension or a conflicting bundler hook is a hard error at construction, not a silent override). Adding a framework or build tool means contributing a facet, not editing the core — nothing framework-specific belongs in the extractor, nothing bundler-specific belongs in the compiler.

### Testing architecture

Unit tests live beside code in `__tests__/`. Above that sits a **contract** layer (`tests/contracts/`):

- A contract declares `requires: Capability[]` (e.g. `["spa", "hmr"]`) and runs against every project claiming those capabilities — it never names a specific app.
- Projects come from a **manifest**: `copiedExampleSource("react-basic")` (a real app under `examples/`, copied per worker so parallel runs don't collide) or `fixtureSource({ id, files })` (a project defined inline for cases no example covers). Prefer a fixture over a new example app when testing one feature against one framework.
- The harness handed to a contract is a **Lab**: page, filesystem, console, HMR socket, compiler, assertions. Per-project quirks (which selector holds the heading, which file to edit) live in an **adapter**, not in the contract.
- **No retries** (`retry: 0`), deliberately — every flake traced in this suite turned out to be a real defect. If a test needs a retry to pass, treat that as a bug report, not flakiness.
- Assert with `lab.assert.textEventually(...)`, never `locator.waitFor({ state: "visible" })` followed by `textContent()` — `waitFor` resolves immediately if the element is already visible showing the _previous_ value, so the read races the update.
- Contract failures attach page state automatically (HMR packet counts, the settle beacon, console errors, DOM contents) — read it before assuming "just flaky".

## Principles

- **No fallback to the source locale, ever.** A missing translation is a build-time error (`verifyIntegrity`), not "show English instead." Don't add a fallback path; make the failure louder instead.
- **Nothing ships that isn't used.** Grammar compiles to JS at build time. The source locale is never written to disk. Dev-only code is eliminated at build time via the `__ZINTL_DEV__` sentinel, not guarded at runtime — a runtime guard the bundler can't fold is dead weight in someone's bundle.
- **Identity is content-based**, not path-based. Anything that ties boundary/translation identity to a file path or line number is a regression.
- **Source stays plain.** Grammatical complexity belongs in catalogs where translators work, not threaded through application code.
- **Frameworks and build tools are facets.** Support for another framework/bundler is additive work, not a core rewrite.

## Publishing

Packages use pnpm `catalog:`/`workspace:*` protocols — **never run `npm publish`** in this repo; it ships those specifiers verbatim and breaks every non-pnpm consumer. `vpr release` (`changeset publish`) detects pnpm and shells out correctly. There is no npm token: publishing authenticates with the workflow's own OIDC identity — pnpm has done trusted publishing since 11.0.7 — trusted per package on npmjs.com and pinned to the `ci.yml` filename. The bare name `zintl` is unobtainable on npm (similarity filter), hence the published names `zintljs`/`@zintljs/*`; the `zintl()` macro identifier is intentionally unrelated to the package name. We are using GitHub Action to publish our packages, please do not publish untill you are asked to do so.

Releases are never dispatched. PRs target `alpha`; a push to a channel branch (`alpha`/`beta`/`main`) opens a `chore: version packages` PR, and merging that PR is what publishes. The channel — version suffix and npm dist-tag — comes from the `.changeset/pre.json` committed on the branch, so adding a channel means creating a branch, not editing `.github/workflows/ci.yml`.

## Mantras Picking

you can pick one of the following mantras to use in your responses:

1. **Mantra 1**: _Measure the shame, sharpen the architecture, Bakalau!_
2. **Mantra 2**: _The bloat is dead, the paths are readable, Claritas!_
3. **Mantra 3**: _The entry is the dictator, the rest are slaves, unless they are the revolt of their times, Mutiny!_
4. **Mantra 4**: _The roots are deep, the branches are many, do not cut them apart, Symbiosis!_
5. **Mantra 0**: _I am god tier architect, i know what i am doing, and i can create my own Mantra/s, Autarch!_
