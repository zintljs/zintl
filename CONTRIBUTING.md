# Contributing to Zintl

Thanks for wanting to help. Zintl is in alpha, which means bug reports and "I couldn't work out how to…" are as valuable as pull requests — the second one is a documentation bug and gets treated as one.

If a term in the codebase is unfamiliar, the [glossary](docs/glossary.md) is the fastest way in. [How it works](docs/architecture.md) covers the model the code is built around.

## Setup

You need **Node** `^22.18.0 || >=24.11.0`, **pnpm**, and the [Vite+](https://vite.plus/) CLI installed globally as `vp`.

```bash
vp install
```

That's it — the `prepare` hook wires up the rest.

## The two gates

Everything is a script, so anything CI runs, you can run identically.

```bash
vpr verify         # build → lint → knip → unit tests → format check  (~1 min)
vpr ready:examples # build 27 example packages → 199 contract tests  (~2 min)
```

`vpr verify` is the fast loop. `vpr ready:examples` drives real browsers against real apps and is what catches integration regressions.

**Build always comes first**, in both. Type-aware lint resolves workspace imports through each package's `dist/*.d.mts`, and `examples/` needs its sibling packages built. Lint before build on a fresh checkout produces ~172 phantom "Cannot find module" errors that mean nothing.

Two more, run before releasing rather than on every change:

```bash
vpr smoke   # packs the real tarballs, installs with npm outside the repo,
            # and builds against stock Vite 6, 7, and 8
vpr bench   # extraction and HMR performance budgets
```

`vpr smoke` is the outside-in check. It deliberately avoids the repo's own tooling — that's the point, and it has caught protocol leaks and wrong peer ranges that every internal test passed straight over.

## Layout

| Path                                       | What it is                                                                              |
| :----------------------------------------- | :-------------------------------------------------------------------------------------- |
| [`packages/zintl`](packages/zintl)         | Published as `zintljs`. The Vite plugin and the macro.                                  |
| [`packages/compiler`](packages/compiler)   | Published as `@zintljs/compiler`. Boundary graph, chunking, ICU baking, runtime source. |
| [`packages/extractor`](packages/extractor) | Published as `@zintljs/extractor`. Framework-blind AST extraction.                      |
| [`packages/testing`](packages/testing)     | Internal, never published. The contract-test harness.                                   |
| [`examples/`](examples)                    | 18 real apps. Not demos — the contract suite drives them.                               |
| [`tests/`](tests)                          | Contracts, fixtures, and manifests.                                                     |
| [`docs/`](docs)                            | User-facing documentation.                                                              |

## How the tests are organised

Unit tests live beside the code in `__tests__/`. Above them sits a contract layer worth understanding before you add to it.

A **contract** is a test that never names an app. It declares what it needs:

```ts
requires: ["spa", "hmr"];
```

…and runs against every project claiming those capabilities. Projects come from a **manifest**, and a manifest declares where its project comes from:

- `copiedExampleSource("react-basic")` — a real app in `examples/`, copied per worker.
- `fixtureSource({ id, files })` — a project defined inline, in the test file itself.

Fixtures exist for cases no example covers, and for combinations that would otherwise cost a whole demo app each. If you want to test a feature against a framework, write a fixture rather than a new example.

Two rules the suite depends on:

**No retries.** `retry: 0`, deliberately. A retry turns a flake into a green run, and every flake traced in this codebase turned out to be a real defect — an assertion that couldn't retry, or contention on a shared directory. If a test needs a retry to pass, that's a bug report.

**Assert with `lab.assert.textEventually(...)`**, never `locator.waitFor({ state: "visible" })` followed by `textContent()`. The second pair looks like it waits but doesn't: `waitFor` resolves immediately when the element is already visible showing the _previous_ value, so the read races the update and the timeout never engages.

Contract failures attach page state automatically — HMR packet counts, the runtime settle beacon, console errors, and what the DOM actually contained. Read it before assuming a test is "just flaky".

## Principles worth knowing before you change behaviour

**No fallback to the source locale. Ever.** A missing translation is not "show English instead" — it's a bug, the way reading an uninitialised variable is a bug. `verifyIntegrity` catches it at build time. Don't add a fallback; make the failure louder.

**Nothing ships that isn't used.** Grammar compiles to JavaScript at build time. The source locale is never written to disk. Dev-only code is eliminated at build time via the `__ZINTL_DEV__` sentinel rather than guarded at runtime — a runtime guard the bundler can't fold is not a guard, it's dead weight in someone's bundle.

**Identity is content-based.** Boundaries hash their content (`b_<hash>`) so renames and refactors don't orphan translations. Anything that ties identity to a path is a regression.

**Source stays plain.** Grammatical complexity belongs in catalogs, where translators work — not threaded through application code.

**Frameworks and build tools are facets.** Nothing framework-specific belongs in the extractor, and nothing bundler-specific belongs in the compiler. Adding support means contributing a facet, not editing the core.

## Making a change

1. Branch, make the change, add tests.
2. Run `vpr verify`, then `vpr ready:examples`.
3. Add a changeset:
   ```bash
   vpr change
   ```
   Say what changed and _why_ — changesets become the changelog people read when something breaks.
4. Open a PR against `alpha`. Open it as a **draft** while you iterate — CI holds off until you mark it ready, so work-in-progress pushes cost nothing.

## CI, channels, and releasing

Every gate runs **once per commit**. On a PR: `verify`, `contracts`, and the publish smoke test when packaging files change. On a push to a channel branch: `verify`, then the release machinery. Nothing re-runs what a green check already covered.

**`CI Gate` is the only required status check.** It aggregates the others and is red whenever a gate that was supposed to run failed, so nothing merges without contracts passing. Individual gates are deliberately not required — a required check that skips (as `contracts` does on the machine-generated version PR) would block that PR forever.

**Releases are never dispatched.** Merging into a channel branch opens a `chore: version packages` PR and stops there. Merging _that_ PR is the release decision: its push is what publishes.

**There is no npm token.** Publishing authenticates with the workflow's own OIDC identity — pnpm has supported trusted publishing since 11.0.7, and it takes precedence over any static token — which is why the packages are configured on npmjs.com to trust `zintljs/zintl` + the `ci.yml` workflow. That trust is pinned to the filename: renaming or splitting the workflow breaks publishing until the trusted publisher is updated to match.

A branch is a release channel because of the `.changeset/pre.json` committed on it:

| Branch  | Prerelease state        | Publishes       | npm dist-tag |
| ------- | ----------------------- | --------------- | ------------ |
| `alpha` | `mode: pre, tag: alpha` | `0.2.0-alpha.N` | `alpha`      |
| `beta`  | `mode: pre, tag: beta`  | `0.2.0-beta.N`  | `beta`       |
| `main`  | none                    | `0.2.0`         | `latest`     |

Cutting a new channel is a branch plus one PR — no workflow change:

```bash
git switch -c beta alpha && git push -u origin beta
git switch -c chore/enter-beta

vp exec changeset pre exit    # mode -> "exit"; the applied-changeset list survives
rm .changeset/pre.json        # forget that the alpha line already applied them
vp exec changeset pre enter beta
```

**The `rm` is the part that matters.** In prerelease mode `changeset version` does not delete changeset files — it appends their names to `pre.json`'s `changesets` array and leaves the files on disk, so an eventual stable release can aggregate the whole line into one entry. `pre enter` carries that array over, so `pre exit && pre enter beta` on its own produces a beta that bumps _nothing_: every changeset is already marked applied and the packages keep their alpha versions. Dropping `pre.json` first makes the line unapplied again, so the beta carries the same content the alpha did.

Two things to expect: the prerelease counter continues rather than restarting (`0.1.0-alpha.10` → `0.1.0-beta.11`), and the channel's changelog entries are re-emitted under the beta version.

Merge that PR, then merge the `chore: version packages` PR it produces, and the beta publishes. It lands on the `beta` dist-tag, not `latest` — changesets only diverts a prerelease to `latest` while _every_ published version carries the current pre tag, which stops being true the moment the tag changes.

A fix that must reach several live channels is one PR per channel, each carrying the same cherry-picked commit and its own changeset. Cherry-pick rather than merging `main` → `beta` → `alpha`: version numbers diverge per channel by design, so branch-to-branch merges conflict in `package.json` and `CHANGELOG.md` every time.

> npm's `latest` currently points at an alpha. That is changesets working as designed — while _every_ published version is a prerelease it publishes to `latest` ("because there has not been a regular release of it yet"). Once a stable ships, prereleases move to their own dist-tags on their own.

Design notes, specifications, and proposals live in [`docs/spec/`](docs/spec). Worth a look before a large change — the reasoning behind a decision is usually recorded there, and `zrs-*` test names refer to sections of [`ZRS.md`](docs/spec/ZRS.md).
