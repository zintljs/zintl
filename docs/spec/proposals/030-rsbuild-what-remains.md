# Proposal 030: Rsbuild — What Remains Before "Fully Supported"

**Status**: AUDIT — opened against a live checkout at `bb5eb9a`, with both gates actually run rather
than quoted. The architectural question is closed and stays closed: 029 built the seam, and nothing
found here reopens it. What remains is **one correctness defect on the Vite path**, **one over-claim
about what "hot updates" covers**, and a **promise layer** — shipped JSDoc, two READMEs, the publish
gate — that still tells a user this target is experimental. None of it is architecture. All of it is
between here and a promise the repository can keep.
**Date**: 2026-08-12
**Depends on**: [026](026-rsbuild-as-falsification-harness.md), [027](027-completing-the-rsbuild-target.md),
[028](028-rsbuild-support-status.md), [029](029-rsbuild-hmr-facet-seam.md), and both ledgers
([026](026-leak-ledger.md), [027](027-leak-ledger.md), through L-036).

## 0. What this is, and how it differs from 028

028 was also a status report, and the resemblance is deliberate — it is the right shape for this
question. The difference is what the question was.

028 asked **"should this be promoted?"** and answered no, for a structural reason it then named.
029 removed that reason. So this document asks the next question — **"what is between the current
state and a promise?"** — and it is written to be actionable rather than exhaustive: every item below
is either a work item with a file attached, or a scope decision that needs stating rather than
solving.

Two house rules are followed strictly, because this document exists to be trusted:

- **Both gates were run, not quoted.** §1 reports what happened on this machine on this date,
  including a failure that the previous three documents' summaries would not have predicted.
- **Reproduced and inferred are marked separately** (026 §6.6). Where a conclusion comes from reading
  code rather than from watching it fail, the entry says so.

## 1. The measurement

Run on 2026-08-12, at `bb5eb9a`, `maxWorkers: 4`.

| Gate                              | Result                                                   |
| :-------------------------------- | :------------------------------------------------------- |
| `vpr ci`                          | **exit 1** — 798 unit ✓ · contracts **1 failed / 147 ✓** |
| `vp test memory-leak` (isolated)  | 4 / 4 ✓                                                  |
| `vpr test:contracts` (second run) | 148 / 148 ✓                                              |

**The counts have moved since 029's header**, which reads 796 unit / 137 contract cases. They are now
798 and 148, which is L-034's and L-035's work plus `examples/rsbuild-react`. That header should be
corrected rather than left to age (§8).

**A note on how the failure was nearly missed**, because it is the exact trap CLAUDE.md documents and
it caught this audit too. The gate was run as `vpr ci > log 2>&1; echo "EXIT=$?"`, and the harness
reported the _compound command's_ exit code — the trailing `echo` — as 0. `vpr ci` had exited 1. The
failure was visible only by reading the log. The rule generalises past pipes: **anything downstream of
the gate can launder its exit code.**

### 1.1 The failure

```
FAIL  tests/contracts/memory-leak.contract.spec.ts > [Memory Leak] react-basic
Error: expected 'Memory Iteration 14' to contain 'Memory Iteration 15'

  hmr packets: {"update":16,"prune":2,"full-reload":2}
  settle beacon: 14 (runtime applied 14 update(s))
  console errors:
    You are calling ReactDOMClient.createRoot() on a container that has already
    been passed to createRoot() before.
```

`react-basic` is a **Vite** project. Rsbuild is not implicated, and this is the fourth time this
sequence has produced a finding on the supported path that a second host merely stood next to —
L-028, L-030 and L-032 were the first three. See §3.

**Frequency, stated exactly**: observed **once in two full-suite runs** on this machine today, and
passing in isolation. That is not a rate, and it should not be quoted as one — it is one
reproduction, which is one more than 024 had.

### 1.2 Versions, per 026 §6.4

Re-resolved from `node_modules`, not carried over from 026's table.

| Tool            | Version                                                       | Date checked |
| :-------------- | :------------------------------------------------------------ | :----------- |
| `@rsbuild/core` | `2.1.10`                                                      | 2026-08-12   |
| `@rspack/core`  | `2.1.8` (transitive)                                          | 2026-08-12   |
| `unplugin`      | `3.3.0`                                                       | 2026-08-12   |
| `vite`          | aliased → `@voidzero-dev/vite-plus-core@0.2.7` (Vite `8.1.5`) | 2026-08-12   |

Unchanged from 026. Every finding in that ledger and in 027's is still pinned to the versions that
produced it.

## 2. What is done

Verified by reading the code at `bb5eb9a`, not by trusting the proposals that claim it.

| Claim                                        | Evidence                                                                                                             |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| No bundler branching outside a facet         | The only `bundler === "rspack"` in `packages/*/src` is a doc comment warning against it (`capabilities.ts:367`)      |
| The HMR seam exists and is host-contributed  | `hmr/{types,plan,applier,vite,rspack}.ts` + `hooks/rspack-hmr.ts`; nothing selects an applier, each host donates one |
| The bundler facet carries the module-system  | `rspackFacet` declares `isVirtualId`, `dynamicImportTemplate`, `hotUpdate`, `dependencyInvalidation`, both HMR hooks |
| Multiplex is fenced, not crashing            | `BundlerFacet.htmlFanOut` + `multiplex-fence` contract against a real `zintljs/rsbuild` build                        |
| Framework detection is honest                | Composition golden reads `frameworks: (none)` for `rsbuild-spa` — L-034's fallback is gone                           |
| The peer dependency is declared and optional | `@rsbuild/core: ^2.1.0` with `peerDependenciesMeta.optional` — 028 §2.8 closed                                       |
| `docs/architecture.md` covers it             | §"Rsbuild is the test of that claim" — 028 §2.7's remaining gap closed                                               |
| Two examples, both in the contract suite     | `examples/rsbuild-spa` (11 capabilities), `examples/rsbuild-react` (8)                                               |

This is the part that is genuinely finished, and it is the expensive part. Everything below is
cheaper than any single item in this table.

## 3. The red gate: React's entry re-execution, now unblocked and reproduced

> **DONE — and it was two defects, not one.** See ledger [L-037](027-leak-ledger.md) and
> [L-038](027-leak-ledger.md). This section's framing was right about the fix and wrong about the
> cause: the double mount was not simply React's mount being replayed, it was **also** a stylesheet
> being repointed onto its sibling component in Vite's module graph — 027 §2.4's hypothesis, open
> since then, and confirmed by a probe that counted entry re-executions per edit. Fixing that halved
> the rate (6/60 → 3/60); `reactRuntimeFacet.entryReexecutionSafe` took the remainder to 1/60.
>
> The measurement this section demanded was made and came back the other way from the guess: the cost
> on Rspack is **zero**, verified by hand against a real `rsbuild dev` (four edits, no reload, no
> double mount, identical to baseline). `rsbuild-react`'s entry acceptance was never what carried its
> component updates.
>
> §10's caveat about the intermittency stands and is now sharper: this machine fails a full contract
> run roughly one time in two to three **regardless of what is applied**, so `vpr ci` being green is
> still not established here. See L-038's closing note.

**Bucket 1 — declare it.** A framework fact, asked of the framework's facet.

024 named this and left it, in terms worth quoting because they are precisely satisfied now:

> **The React `createRoot` case remains latent**: marking React unsafe reaches every framework-less
> project, because `FALLBACK_FRAMEWORK` is `"react"`, and it regressed `vanilla-spa-basic`. The fix is
> one facet field away once there is a reproduction to justify it.

Both conditions have since changed, independently and without anyone connecting them:

- **The blocker is gone.** L-034 deleted `FALLBACK_FRAMEWORK` and `detectFrameworksOrFallback`.
  `detectFrameworks` returns `[]` honestly, and eleven framework-less projects now resolve no React
  facets at all. Marking React unsafe no longer reaches anything that is not React.
- **The reproduction exists.** §1.1 is it — `full-reload: 2`, a `createRoot()` double-mount warning,
  and one lost iteration, which is the same signature 024 §1.3 described.

The state of the code today: **only `svelte.ts:131` declares `entryReexecutionSafe: false`**. React
defaults to `true`, and `rsbuild-react`'s composition golden confirms it resolves `true`.

So the fix 024 predicted is available exactly as predicted, and it is the one item in this document
that blocks the gate rather than the promise.

**One thing to establish before writing it**, and it is why this is a work item rather than a
one-line patch: React declining re-execution means every React edit becomes a full page reload on
**both** hosts, which is a real cost to the Vite path's dev experience. L-032 landed
`useSyncExternalStore` injection for plain React apps, so a React component now genuinely re-reads the
catalog on `notify()` — which may mean the entry never needed to re-execute in the first place, and
that the double-mount is now avoidable rather than merely survivable. **That ordering is inferred from
reading L-032, not measured.** Measure it before choosing between "declare React unsafe" and "stop
the entry from being the thing that re-executes."

## 4. The over-claim: hot updates on Rspack are React-only

> **DONE.** The claim held, it is now measured rather than read, and the corrections are in. Two
> things are worth carrying forward.
>
> **The inventory below was incomplete.** It named three locations; there were **five**. The two it
> missed were `docs/architecture.md` ("feature parity for SPA builds _and_ dev-time hot updates") and
> `examples/rsbuild-react/README.md`, which opened by crediting `rsbuild-spa` with hot updates —
> the app that reloads. An audit assembled by grepping the phrase it expected found the phrasings it
> expected; the two misses used different words for the same claim.
>
> **Measured against real dev servers on 2026-08-12**, which is what §9 said had to happen before the
> wording could be chosen:
>
> | App                           | Edits | Text correct | Page reloaded |
> | :---------------------------- | :---- | :----------- | :------------ |
> | `rsbuild-react` (component)   | 4     | 4 / 4        | never         |
> | `rsbuild-spa` (vanilla entry) | 2     | 2 / 2        | **both**      |
>
> The `rsbuild-spa` pass covered the source locale and `?lang=ar`, since the README claimed both;
> `<html dir="rtl">` survived the reload and the Arabic text correctly did **not** change, because the
> edit was to the source string and reconciliation remapped the key.
>
> The corrected docs describe the **rule** — an app whose components re-read the catalog repaints in
> place, one without them reloads — and then name React as today's instance, rather than stating the
> instance as if it were the rule. `architecture.md` gained a sentence putting that where it belongs:
> it is a framework question, not a bundler one, which is why the bundler-agnostic claim above it is
> unaffected.

**Established by reading the code, corroborated by L-035's own measurements, not independently
re-measured in a browser here.**

The mechanism is three links long and each one is in the repository today:

1. `hasClientReactivity` is `Object.keys(clientReactivityImports).length > 0` (`index.ts:1822`).
2. **Only `react.ts:92` declares `clientReactivityImports`** — no other preset does, vanilla, Vue and
   Svelte included.
3. `rspackFacet.hmrInjectionCode` emits `accept()` only when
   `hasAnchors && entryReexecutionSafe && hasClientReactivity` (`rspack.ts:138`).

So on Rspack, **every non-React app declines the update and full-reloads per edit.** That is L-035,
it is deliberate, and it is correct — a vanilla entry re-seeds its store from a module binding Webpack
has cached, so accepting would render `""` permanently. Reloading is the honest trade.

What is not correct is how it is described. Five places told a user the opposite — the first three
were found by this audit, the last two only once the corrections were being written:

| Location                           | Said                                                              |
| :--------------------------------- | :---------------------------------------------------------------- |
| `examples/rsbuild-spa/README.md`   | "`pnpm dev` applies a string edit **without reloading the page**" |
| `examples/rsbuild-spa/README.md`   | "`pnpm dev  # rsbuild dev — with hot updates`"                    |
| `docs/configuration.md`            | "dev-time string edits **without a page reload**"                 |
| `docs/architecture.md`             | "feature parity for SPA builds _and_ dev-time **hot updates**"    |
| `examples/rsbuild-react/README.md` | "`rsbuild-spa` established that Zintl builds and **hot-updates**" |

The first two are on the one app where it reloads. **Nothing catches this**, and the reason is worth
recording: the `hmr` contract asserts the heading reaches the new text, and a reload reaches it. The
contract is right to accept both — the app is correct either way — but it means the _wording_ has no
test behind it, and wording is what a user reads before they ever run anything.

`vanilla-spa-basic` on Vite hot-updates without a reload, so the two hosts genuinely differ here for
the same app shape. That difference is defensible; describing it as absent is not.

## 5. The promise layer

> **DONE.** All three parts, and §5.3 is the one that turned out to matter most in practice.
>
> **§5.1** — `rsbuild.ts`'s module doc now describes what the entry point is rather than what the
> spike that created it was for: supported for SPAs in build and dev, the peer range, the two
> deliberate exclusions, and the `modulepreload` difference. It also carries §4's rule, because a
> user hovering the import is exactly who needs to know why their vanilla app reloads.
>
> **§5.2** — both READMEs gained Rsbuild: a collapsed config block next to the Vite one (spread, since
> the entry point returns an array), and a "Where it runs" that names both bundlers as optional peers
> and says plainly that `multiplex` and SSR are Vite-only.
>
> **§5.3** — `scripts/smoke.js` now runs the same four phases against `zintljs/rsbuild`: install with
> npm, first build must fail on the integrity check, fill the scaffolded catalogs, second build must
> bake the translation in. The app is byte-identical across hosts on purpose, the same discipline
> `examples/rsbuild-spa` applies against `vanilla-spa-basic` — the only differences are the config
> file and that Rsbuild names its entry in config rather than in the template, which is L-021.
>
> **It passes, and the run is the point.** Verified against a real `npm install` outside the
> workspace, which resolved **`@rsbuild/core@2.1.11`** — a newer patch than the workspace's `2.1.10`,
> which is precisely the drift a workspace cannot show you. `--vite=none` and `--no-rsbuild` select
> a single host; the default now covers both. The Vite path was re-run after the refactor and is
> unchanged.

Nothing here is a defect in the integration. All of it is what a user encounters _before_ the
integration runs, and it currently contradicts the repository's own conclusion.

### 5.1 The shipped JSDoc says the opposite of the docs

`packages/zintl/src/rsbuild.ts`'s module comment ships in `dist/rsbuild.d.mts` and renders in a user's
editor on hover. It is three proposals stale, and not gently:

> "It is not a supported target, and the `zintljs` package does not yet promise it will behave."
> "Tier 2 — hot updates — is not attempted here, and should not be until the two load-bearing
> requirements in §7a … are shown to exist on this host."
> "`this.resolve` does not exist … `emitFile` returns nothing … The HTML fan-out, SSR and multiplex
> paths are untested on this host."

029 §1 established those §7a requirements. 027 built the HTML seam. L-022 fenced multiplex rather than
leaving it untested. Meanwhile `docs/architecture.md:94` and `examples/rsbuild-spa/README.md` both
call this a supported target. **The most authoritative surface — the one that needs no navigation to
find — is the one still saying no.**

### 5.2 Both READMEs are Vite-only

- `README.md:96` — "Today Zintl ships a **Vite plugin**". No mention of Rsbuild anywhere in the file.
- `packages/zintl/README.md:106` — "Requires **Vite 6, 7, or 8**". This is the published package's
  npm landing page.

A target cannot be fully supported while the front door does not list it.

### 5.3 The publish gate never installs it

`scripts/smoke.js` packs real tarballs, installs them with npm outside the workspace, and builds
against stock Vite — writing a `vite.config.js` and a Vite-only matrix. **`zintljs/rsbuild` is never
exercised from a packed tarball.**

This is the gap with the sharpest teeth in the whole document, because of what the smoke gate exists
to catch: the workspace resolves `unplugin`, `@rsbuild/core` and the `./rsbuild` export through pnpm's
store and workspace links, and a real consumer does not. L-004's own subject — unplugin materialising
virtual modules under `node_modules/.virtual/` — is exactly the kind of behaviour that can differ
between a workspace and an npm install, and nothing would tell us.

Also worth noting: `pnpm-workspace.yaml:13` still carries the comment _"Proposal 026 falsification
harness. Not a supported target"_ above the Rsbuild catalog entries.

## 6. Capability parity

Computed by matching each manifest's capability list against every contract's `requires` — a
positive-only subset test, per `runner.ts`. **Derived, not read off a reporter listing.**

| Project             | Contracts run | Missing, against its closest Vite peer                                                  |
| :------------------ | :------------ | :-------------------------------------------------------------------------------------- |
| `rsbuild-spa`       | **16**        | `chaos-boundary`, `chaos-catalog`, `memory-leak`, `performance-hmr`, `performance-size` |
| `vanilla-spa-basic` | 20            | (`assets`, which `rsbuild-spa` claims and it does not)                                  |
| `rsbuild-react`     | **13**        | the five above, plus `hmr-hammer` and `locale-storm`                                    |
| `react-basic`       | 20            | —                                                                                       |

Triaged, because the five are not one kind of thing:

| Missing                                         | What it actually is                                                                                                                            | Verdict                           |
| :---------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- |
| `performance-size`                              | A contract that filters responses by Vite-shaped URLs, whose own header concedes it measures dev-wrapped modules                               | **Fix the contract**, both hosts  |
| `performance-hmr`                               | Blocked with it                                                                                                                                | Follows                           |
| `memory-leak`                                   | Two compilations per edit here — Zintl's catalog write is necessarily a declared dependency (029 §4.1) — plus reload-per-edit on a vanilla app | **Real cost.** Decide, don't skip |
| `chaos-boundary`                                | The contract renames the heading's file; here that file is the entry, named in `rsbuild.config.mjs`                                            | **Contract limitation**           |
| `chaos-catalog`                                 | Gated behind `chaos` with it                                                                                                                   | Follows                           |
| `hmr-hammer`, `locale-storm` on `rsbuild-react` | Nothing known to block them; never claimed                                                                                                     | **Free coverage — try it**        |

The last row is the only one that looks like plain unclaimed-but-earnable coverage, and it should be
attempted before this target is called complete: `hmr-stress` and `locale-switch-stress` are exactly
the contracts that find ordering defects, and `rsbuild-react` is the only project combining a
framework with a non-Rollup host.

## 7. Scope decisions to state, not solve

These are not work items. They are things "fully supported" must say out loud, so that support means
something checkable rather than something assumed.

| Item                   | Current state                                                                                                  | What must be stated                                              |
| :--------------------- | :------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| **SSR on Rspack**      | Unbuilt, unexamined, in all four proposals. `modifyHtmlHook` bails loudly on non-`"web"` targets               | The largest functional gap. Supported-for-SPA, or a new proposal |
| **`multiplex` / MPA**  | Fenced with a clear error (L-022); 029 §5 calls the exclusion permanent                                        | Permanent, in the support statement itself                       |
| **L-005** (`emitFile`) | Unreproduced, permanently behind the multiplex path                                                            | Need not be answered unless multiplex scope changes              |
| **`modulepreload`**    | The projection injects `preloads: {}` on this host (`hooks/html.ts:124`)                                       | One extra round-trip vs Vite. A stated difference, not a defect  |
| **First-run reload**   | No `isWritingFile` equivalent; the first `rsbuild dev` on a project with no HTML catalog reloads once (028 §3) | A first-run wrinkle, self-correcting                             |
| **webpack (classic)**  | ~90% of findings should transfer; nothing validates it                                                         | Claiming it without a run is 026's N=1 error, twice              |

## 8. Documentation drift

Every one of these was true at the moment it was written and is false now. Collected because a
"supported" claim is only as good as the least accurate thing next to it.

| Location                                                           | Says                                                                                                                                                        |
| :----------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/zintl/src/rsbuild.ts`                                    | Not a supported target; hot updates not attempted (§5.1)                                                                                                    |
| `README.md`, `packages/zintl/README.md`                            | Vite-only (§5.2)                                                                                                                                            |
| ~~`rsbuild-spa/README.md`, `configuration.md`, `architecture.md`~~ | ~~Edits apply without a reload (§4)~~ — **corrected**                                                                                                       |
| `tests/manifests/rsbuild-react.ts`                                 | "**Not `hmr`** … 4/4 blank headings" — while the list below it claims `hmr`                                                                                 |
| `examples/rsbuild-react/README.md`                                 | Same, as its current measured state. Its opening hot-update claim was corrected by §4; the "4/4 blank" body and Status section remain                       |
| `packages/testing/src/contracts/types.ts:123`                      | An `"rsbuild"` driver is "a 026 falsification target, not a supported configuration … should claim only build-time capabilities"                            |
| `pnpm-workspace.yaml:13`                                           | "Not a supported target"                                                                                                                                    |
| `docs/spec/proposals/027-…md`                                      | Status still **IN PROGRESS**                                                                                                                                |
| `docs/spec/proposals/029-…md`                                      | Header still says `hmr`/`hmr-stress` were dropped from `rsbuild-spa` — L-035 re-claimed both, and L-036 explained the timeouts that motivated dropping them |

The `rsbuild-react` pair is the instructive one: the manifest's prose argues _against_ a claim its own
capability list makes, four lines below. That is what happens when a capability is earned in one
session and the paragraph explaining why it could not be earned survives.

## 9. What "fully supported" should mean, and the order

A definition first, because "supported" without one is a feeling:

> **Rsbuild is supported for SPA builds and dev.** Production builds, dev server, hot updates on
> frameworks that declare client reactivity, full-reload-on-edit elsewhere, per-locale `<html lang>`
> and `dir`, localized assets, chunk-aligned catalogs and ghost mode. **Not** SSR. **Not** `multiplex`
> — permanently. Tested against `@rsbuild/core@^2.1.0`, in CI, on every change.

Everything in this document is then either a step to earning that sentence or a clause inside it.

```
§3  React entryReexecutionSafe        ← blocks the gate; measure L-032's effect first
      ↓
§4  correct the hot-update wording    ← blocked by nothing; do it with §3's measurement in hand
      ↓
§5.1 rewrite the shipped JSDoc   §5.2 both READMEs   §8 the drift sweep
      ↓
§5.3 smoke covers zintljs/rsbuild     ← the last thing that can fail in a consumer's install
      ↓
§6  claim hmr-stress / locale-switch-stress on rsbuild-react
      ↓
§7  write the support statement, with its exclusions, where a user finds it
```

Only two orderings are real: §3 before §4, because the measurement it needs decides the wording; and
§5.3 before any release that promises this, because it is the only gate standing between a workspace
that resolves and a consumer that does not.

## 10. What this document does not cover

- **SSR on Rspack.** Named in §7, unexamined here, as in 026 §7, 027 §6 and 029 §5.
- **A rate for §1.1.** One reproduction in two runs is not a frequency, and this document does not
  pretend otherwise. If §3's fix is deferred, the next thing to produce is a batch of runs.
- **Whether L-032 removed the need for React entry re-execution at all.** §3 says this is inferred
  from reading and must be measured. It is the single most load-bearing unmeasured claim here.
- **Vue and Svelte on Rspack.** No example exists. §4's mechanism says they behave as vanilla does —
  decline and reload — which is a **prediction from reading the code**, not an observation.
