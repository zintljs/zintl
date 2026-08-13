# Zintl Delivery Bus Specification (ZDB)

**Version**: 1.0
**Status**: Draft
**Absorbs**: [`proposals/024-delivery-bus-and-update-ordering.md`](proposals/024-delivery-bus-and-update-ordering.md)
**Amends**: [ZRS](ZRS.md) §9.1 (failure model), [ZHMR](ZHMR.md) §2 (invalidation pipeline)

---

## §0 — What this specifies, and why it exists

Zintl performs the same shape of work in four places: something changes, a procedure runs, and a result is delivered somewhere else. A file changes and a packet is emitted. A catalog arrives and a store applies it. A flush is requested and disk is written. A facet is asked and contributes.

Every one of those is repetitive, concurrent, and capable of conflicting with itself. Until this specification, none of them had a name for **what** was being delivered, **in what order**, or **whether it landed**. The measured consequences were: a later update losing to an earlier one, a boundary rendering blank forever with nothing recorded, a flush silently discarding the boundaries a second flush had dirtied, and outputs surviving on disk after the source that produced them was gone.

ZDB is not a message queue and not a transport. It is a **governance discipline**: five absolute axioms plus the smallest data structure that makes them enforceable. The rule it exists to establish is one sentence.

> **A procedure may not lose to an earlier version of itself, and may not disappear without a name.**

Where ZRS governs _what belongs to which boundary_, ZDB governs _what happens to a change once something decides to act on it_.

---

## §1 — Standard Entities

| Symbol | Entity       | Definition                                                                                                                                                                     |
| :----- | :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| $E$    | **Envelope** | The unit of governed delivery. Carries identity, sequence, and outcome.                                                                                                        |
| $C$    | **Channel**  | A namespace of comparable work. Envelopes are only ever ordered _within_ a channel.                                                                                            |
| $J$    | **Subject**  | The supersession key inside a channel — a boundary id, a locale, a file path, an output path. Two envelopes with the same $(C, J)$ describe the same thing at different times. |
| $Q$    | **Sequence** | A monotonic number, scoped to $(C, J)$. The sole authority on which of two envelopes is newer.                                                                                 |
| $O$    | **Outcome**  | The terminal state of an envelope: `applied`, `superseded`, or `failed`.                                                                                                       |
| $K$    | **Custody**  | The obligation, held by whichever stage currently possesses an envelope, to drive it to a terminal outcome.                                                                    |
| $L$    | **Ledger**   | The development-only record of envelopes and their outcomes.                                                                                                                   |

### §1.1 — Schema

```typescript
interface Envelope {
  /** Namespace of comparable work. Ordering is never cross-channel. */
  channel: Channel;
  /** The supersession key within the channel. */
  subject: string;
  /** Monotonic within (channel, subject). The only ordering authority. */
  seq: number;
  /** Terminal state. `pending` is not terminal — see Axiom D2. */
  outcome: "pending" | "applied" | "superseded" | "failed";

  // Development-only. Eliminated from production by `__ZINTL_DEV__`.
  /** The seq of the envelope that caused this one. Builds the custody chain. */
  cause?: number;
  /** Why an envelope failed or was superseded. */
  reason?: string;
}

type Channel =
  | "runtime/catalog" // subject = <locale>/<boundaryId>
  | "runtime/locale" // subject = "active" — the one active-locale slot
  | "build/hmr" // subject = source file path
  | "build/pipeline" // subject = stage name
  | "io/write"; // subject = output path
```

`seq` and `subject` are production-grade. Everything else is development-only (§8).

---

## §2 — The Delivery Axioms

These axioms are **absolute**. They resolve every ambiguity in this specification, in the same sense that the Handshake Axioms (ZRS §4) resolve boundary ownership.

### Axiom D1: Monotonic Supersession

> A receiver holds $\text{lastApplied}[J]$ and **MUST** discard any envelope whose $Q$ does not exceed it.

Latest wins **by number**, never by arrival time, never by a timing window, never by a debounce. A receiver that has applied $Q = 5$ and then receives $Q = 3$ discards $Q = 3$ — not because it arrived late, but because it is older, which is a fact the envelope carries rather than a fact the receiver has to infer.

This is what makes an intermediate final state _structurally impossible_ rather than merely unlikely. A race can still occur; it can no longer produce a wrong outcome.

**Corollary D1a.** Debouncing is never a correctness mechanism. It may be used to reduce work; it may never be relied upon to produce ordering. A debounce window that is correct on a fast machine and wrong under load is not a guard.

### Axiom D2: No Silent Abandonment

> Every minted envelope **MUST** reach a terminal outcome: `applied`, `superseded`, or `failed`.

Coalescing is `superseded` — a named outcome, not a disappearance. A discarded update is `superseded`. A load that resolved empty is `failed`. A write suppressed by a self-write guard is `failed`, with the reason.

An envelope that reaches no terminal state is, by definition, a defect; the ledger names it rather than the system forgetting it. This is the axiom that turns "the element is blank and nobody knows why" into a diagnosable event.

**Corollary D2a.** An outcome must be recorded even when the result was a no-op. An idempotent redelivery is `applied`. If "applied, unchanged" and "lost" produce the same observable, no observer can distinguish a working system from a broken one — and a silent fallback and a working signal are indistinguishable by construction.

### Axiom D3: Causal Custody

> Custody passes end to end. A stage that coalesces two envelopes **MUST** inherit the superseded envelope's subject set, so that no subject is left without a custodian.

The guarantee begins where a change enters the system — a write to disk, a locale set by a user — and ends where it is applied or explicitly superseded. It does not begin at the point a message is received.

A stage that returns an in-flight promise to a second caller has broken custody: the second caller's subjects were never adopted, and the caller is handed a signal that means "someone else's work finished," not "your work landed."

### Axiom D4: One Subject, One Owner

> Where two contributors may act on one subject, resolution is by **declared rank**, and a tie is a **hard error at construction** — never silent first-wins, never silent last-wins.

This is the rule already enforced for four facet hooks, generalized to a system rule. Silent first-wins makes a second contributor's code unreachable; silent last-wins makes the outcome depend on iteration order. Both are the system tricking itself into a position no one chose.

Where multiple contributors legitimately participate, the composition must be **declared** and must be one of: `union` (all contribute, order-independent), `ranked` (exactly one wins, tie is a hard error), or `chain` (all run in declared order, first non-`undefined` wins).

### Axiom D5: Cost Asymmetry

> $J$ and $Q$ ship to production. $L$, `cause`, `reason`, and all reporting are development-only and **MUST** be eliminated at build time.

Ordering is correctness and is never optional. Observability is diagnosis and is never shipped.

Elimination gates on the `__ZINTL_DEV__` sentinel, which `getRuntimeCode()` substitutes to a literal. It **MUST NOT** gate on `typeof process !== "undefined"` — that expression is unfoldable by the bundler and evaluates false in browsers, which silently disabled every development branch in the runtime for the project's entire life before it was found.

---

## §3 — Channels

A channel is a namespace of comparable work. Envelopes are ordered strictly within a channel, and never across channels — there is no global clock, and this is deliberate: the runtime store is request-scoped under SSR (`AsyncLocalStorage`), and a process-global counter would leak sequence state across concurrent requests.

| Channel           | Subject $J$                           | Sequence source $Q$                                                  | Receiver holds                         |
| :---------------- | :------------------------------------ | :------------------------------------------------------------------- | :------------------------------------- |
| `runtime/catalog` | `<locale>/<boundaryId>`               | `boundaryRevisions` (compiler-minted, travels with the catalog)      | last applied revision per subject      |
| `runtime/locale`  | `"active"` — a single constant        | store-local counter                                                  | the seq holding the active-locale slot |
| `build/hmr`       | absolute source file path             | the bundler's HMR `timestamp` (strictly monotonic, never duplicates) | last processed timestamp per file      |
| `build/pipeline`  | stage name (`flush`, `graph`, `hive`) | stage generation counter                                             | last committed generation              |
| `io/write`        | absolute output path                  | owning `build/pipeline` generation                                   | generation that owns the file on disk  |

Two of those subjects are easy to get wrong, and both were wrong in this document's first draft:

- **`runtime/catalog` is keyed by locale _and_ boundary.** A catalog is only meaningful for one language, and a boundary's Arabic and French catalogs are separate deliveries that must not supersede one another.
- **`runtime/locale` has exactly one subject, not one per locale.** The thing being superseded is the store's _active-locale slot_, of which there is one. Keying by target locale would let a switch to `fr` and a switch to `ar` proceed as unrelated deliveries — which is the interleaving the channel exists to prevent.

The general rule the two illustrate: **the subject is the resource being contested, not the value being delivered.**

### §3.1 — Sequence sources are adopted, not invented

Two monotonic counters already exist in the system and are wasted. ZDB adopts them rather than minting parallel clocks that would then need to be kept in sync.

- **`build/hmr`** uses the bundler's own HMR timestamp. It is already handed to the hot-update hook, is strictly monotonic by construction, and already travels to the browser as the `?t=` query parameter on rewritten imports.
- **`runtime/catalog`** uses `boundaryRevisions`, the compiler's per-boundary counter. Before ZDB it was _summed across a file's boundaries_ into a token emitted as a source comment — a value that is not injective (two boundaries at revision 1 is indistinguishable from one at revision 2) and that nothing reads. Under ZDB it stops being summed and becomes the envelope's sequence.

### §3.2 — The wire

ZDB **does not introduce a transport**. Zintl has no custom HMR channel — the only wire messages it sends are full-reload notices — and adding a protocol would create a surface to version and would defeat the in-process packet interception the test harness relies on.

The `runtime/catalog` envelope rides the existing carrier: the per-file code the bundler facet already injects into every transformed module, which already receives a per-boundary revision. The envelope replaces the comment that revision is currently discarded into.

---

## §4 — Supersession Rules

### §4.1 — The receiver rule (D1, normative)

```typescript
function accept(env: Envelope, lastApplied: Map<string, number>): boolean {
  const prior = lastApplied.get(env.subject);
  if (prior !== undefined && env.seq <= prior) {
    settle(env, "superseded"); // D2 — named, not dropped
    return false;
  }
  lastApplied.set(env.subject, env.seq);
  return true;
}
```

Note `<=`, not `<`. A redelivery at the same sequence is `superseded`, not `applied` — it carries no new information, and saying otherwise would let a duplicate masquerade as progress.

### §4.1a — Where D1 does **not** apply

D1 governs deliveries that **replace** state. A newer catalog makes an older one irrelevant, so discarding the older one loses nothing — that is what makes supersession safe.

Work that **accumulates** is not a delivery in this sense, and must never be discarded by sequence. Compiler invalidation is the clear case: each watcher event marks boundaries dirty, clears caches and re-extracts, and each may describe a different state of the file. Dropping one because a higher sequence was already seen throws away work no later event will redo — and the update it would have produced is simply never emitted.

The test for which kind you have:

> If the newest envelope alone would leave the system in the correct state, it replaces, and D1 applies. If earlier envelopes contributed something the newest does not carry, it accumulates, and D1 does not.

For accumulating work, use custody (D3) to **deduplicate one event reported more than once**, and enforce ordering downstream at the point where the result really is a replacement. On the `build/hmr` channel that means: several environments reporting the same event join one invalidation, every event is processed, and the ordering guarantee is carried by the generation stamped into each generated catalog.

This is not hypothetical. Applying D1 to invalidation directly regressed `hmr-hammer` from zero failures in seventeen runs to two, reproducing the exact signature §1.1a records — one fewer packet than there were writes.

### §4.2 — In-flight work

When a newer envelope arrives for a subject with work already in flight, the in-flight work is **allowed to complete and its result discarded by D1**. It is not cancelled.

This resolves the open question in proposal 024 §6. Cancellation is cleaner in the abstract, but it costs an `AbortController` per load in production bytes, and D1 already makes the late result harmless — a completed load whose sequence has been overtaken simply fails §4.1 and settles as `superseded`. Paying for cancellation would buy nothing that the axiom does not already guarantee.

### §4.3 — Coalescing (D3, normative)

A stage that collapses two requests into one **MUST** adopt the superseded request's subjects:

```typescript
// Correct — custody is inherited.
if (inFlight) {
  inFlight.subjects.add(...incoming.subjects);
  settle(incoming, "superseded", "merged into generation " + inFlight.seq);
  return inFlight.promise;
}
```

Returning `inFlight.promise` _without_ the adoption is the defect: the caller receives a completion signal for work that never included its change, and — where the coalescing stage also clears a shared dirty set on completion — the second caller's subjects are actively destroyed rather than merely deferred.

**Deferral satisfies this axiom; destruction does not.** Once the subjects survive, returning the in-flight promise is permitted: the guarantee D3 asks for is that no subject is left without a custodian, not that the caller's own promise is the one that resolves when its work lands. Upgrading to the stronger reading — a follow-on run per mid-flight caller — is a real cost and occasionally a hazard, because a stage whose body re-enters the system can queue its own successor forever. Pay for it only where a caller genuinely reads back what it wrote.

### §4.4 — Locale capture

Any procedure that reads a locale, performs an `await`, and then writes a result **MUST** use the locale captured before the await, never the instance's current locale after it. Reading the mutable field after an await files locale A's catalog under locale B's key whenever a switch lands mid-flight.

---

## §5 — The Ledger

The ledger is a **bounded ring** of envelopes and their outcomes, per channel. It is development-only (D5).

- **Bounded is normative, not an optimization.** The `memory-leak` contract measures retained heap across twenty consecutive hot updates against a 3.5 MB budget with roughly 700 KB of headroom. An unbounded history fails it.
- **Default capacity**: 128 entries per channel.
- **Runtime view**: `globalThis.__zintl_ledger`. The settle beacon `globalThis.__zintl_version` survives as a _derived_ value — the count of **terminal outcomes**, not only `applied` — so every existing reader continues to work unchanged. Counting supersessions and failures too is deliberate: an observer asks "has the store finished with my change?", and `superseded` is a finished answer. Notifying subscribers stays a separate concern, and still happens only on real change.
- **Compiler view**: exposed on `CompilerContext`, and therefore reachable by the test harness through the live-compiler handle. It is available in project mode, where there is no page and no socket.

### §5.1 — What the ledger is for

To diagnose, and to falsify. Instrumentation exists to disprove a hypothesis, not to confirm one — the negative result that eliminated delivery failure as the cause of the original ordering defect was worth more than the positive one that was expected.

---

## §6 — Failure Model

**This section replaces [ZRS](ZRS.md) §9.1**, which described a source-locale fallback and an exponential-backoff retry. Neither exists in the code, and the first is forbidden outright: a missing translation is a build-time error, not a reason to show a different language.

| Failure                                      | Outcome      | Behaviour                                        |
| :------------------------------------------- | :----------- | :----------------------------------------------- |
| Loader resolves empty                        | `failed`     | Recorded with the boundary and locale. No retry. |
| Loader rejects                               | `failed`     | Recorded with the rejection. No retry.           |
| Loader throws synchronously                  | `failed`     | Recorded with the throw. No retry.               |
| Update superseded by a newer sequence        | `superseded` | Expected, not an error.                          |
| Write suppressed by the self-write guard     | `failed`     | Recorded with the suppressing path.              |
| Stage coalesced into an in-flight generation | `superseded` | Subjects adopted per §4.3.                       |

**Retry is deliberately absent.** A retry cannot fix ordering — re-delivering an out-of-order update produces the same wrong final state — and it converts a loud failure into a slow one. The system does not need to try harder; it needs to know what it is delivering, in what order, and whether it landed. Where recovery is genuinely wanted, it belongs above this layer, driven by a `failed` outcome the layer made visible.

---

## §7 — Facet Governance (D4 applied)

Every fan-out across the resolved facet set **MUST** declare its composition. There are exactly three legal compositions.

| Composition | Semantics                                                                          | Conflict behaviour                      |
| :---------- | :--------------------------------------------------------------------------------- | :-------------------------------------- |
| `union`     | Every contributor participates; the result is order-independent                    | none possible                           |
| `ranked`    | Exactly one contributor wins, by declared priority                                 | **hard error at construction** on a tie |
| `chain`     | All contributors run in declared priority order; first non-`undefined` result wins | none — order is declared                |

A fan-out whose composition is not declared is a specification violation. In particular:

- A `for … await` loop over facets that assigns into a shared object is `union` only if key collisions are impossible; otherwise it is `ranked` and must say so.
- A loop that `break`s or `return`s on the first implementer is `ranked` with an undeclared rank, which makes every later contributor unreachable. It must become an explicit `ranked` or an explicit `chain`.

Facet lifecycle steps (`setup`, `discover`, `flush`) are `build/pipeline` subjects: a facet that fails is named by the ledger rather than swallowed by the surrounding sequential await. It also does not take the remaining facets with it — the composition is `union`, so the facets are independent and one failing does not make the others wrong.

### §7.1 — The declared composition of every fan-out

| Fan-out                                                                | Composition  | Conflict                                                  |
| :--------------------------------------------------------------------- | :----------- | :-------------------------------------------------------- |
| extraction targets, extensions, rules                                  | `union`      | none possible                                             |
| runtime capability booleans                                            | `union` (OR) | none possible                                             |
| `getTranslations`                                                      | `union`      | same key, different value → **hard error**                |
| `getProtectedCatalogKeys`                                              | `union`      | none — the result is a set                                |
| `transformHtml`                                                        | `chain`      | none — each facet sees the previous output                |
| `detectLocale`                                                         | `chain`      | none — first non-`undefined` wins, order declared         |
| `getBoundaryForLocalizedOutput`                                        | `chain`      | none — first claim wins, order declared                   |
| `wrapCode`, `wrapDefault`                                              | `ranked`     | tie at equal priority → **hard error**                    |
| `resolveVirtualPath`, `dynamicImportTemplate`, `hmrInjectionCode`      | `ranked`     | tie at equal priority → **hard error**                    |
| codegen facets (per extension)                                         | `ranked`     | two claiming one extension at equal rank → **hard error** |
| `setup`, `discover`, `flush`, `getStateToSave`, `getActiveOutputPaths` | `union`      | none — independent, failures isolated and named           |

---

## §7a — Bundler Requirements

Zintl's compiler is bundler-agnostic; the host plugin is not. Support for another build tool is a facet, not a rewrite (SPEC §1) — but a facet can only be written where the tool provides what the channels below need. Two tiers, and the line between them is exactly the `build/hmr` channel.

### Tier 1 — Build

Everything Zintl does at build time. Needs only:

| Requirement                                 | Used for                                                                                         |
| :------------------------------------------ | :----------------------------------------------------------------------------------------------- |
| Virtual modules                             | catalogs, content and managers (`resolveId` + `load`, with an opaque-id convention such as `\0`) |
| A `transform` hook with stable per-file ids | extraction and source mutation                                                                   |
| Build lifecycle hooks                       | `buildStart` → discovery, `buildEnd` → flush                                                     |
| Plugin ordering                             | Zintl must run before framework transforms (`enforce: "pre"`)                                    |
| HTML transformation                         | projections and the bootstrap script — optional, HTML entries only                               |

Every bundler unplugin targets can meet this tier. It is where support for a new tool should start.

### Tier 2 — Development

Hot updates. Needs everything above, plus:

| Requirement                                        | Used for                                                                                              |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| A hot-update hook carrying the changed file        | the `build/hmr` subject                                                                               |
| **A monotonic, non-repeating timestamp per event** | the `build/hmr` sequence (§3.1) — without it there is no ordering authority and D1 cannot be enforced |
| **`read()` for the content of _that_ event**       | §4.1a — reading the file independently is how a later write becomes a no-op                           |
| Module-graph access with per-module invalidation   | invalidating managers, catalogs and content modules                                                   |
| A per-module update token that reaches the client  | cache-busting the re-fetch (`?t=`)                                                                    |
| A server→client message channel                    | full reloads for server-only boundaries                                                               |

The second and third rows are the load-bearing ones, and they are why this tier is narrower than the first. A bundler that provides a hot-update hook without a monotonic per-event sequence can deliver updates but cannot **order** them — which is the defect this entire specification exists to remove, so shipping dev support on such a tool would be shipping the bug back.

### Where to start

Take a bundler unplugin already supports, implement Tier 1 as a `BundlerFacet`, and confirm the build contracts pass. Only then look at Tier 2, and only for tools that genuinely provide the two load-bearing rows — do not emulate them with a counter of your own, because a second clock that can disagree with the bundler's is worse than no clock at all.

### The worked second example: Rspack

Rsbuild/Rspack has been through both tiers (proposals 026–030), and how it answers the Tier-2 table is
worth recording, because it is not the shape this section originally imagined.

One caveat belongs with the table rather than after it: the `watchRun` row was **specified for two
years before it was reached**. unplugin never called the escape hatch the tap was registered from, so
Rspack's guarantees were available and unused, and the host worked through its ordinary
transform-and-flush path. The tap is registered as of proposal 030 (ledger L-041), and the guarantees
below are now in play rather than merely present.

| Requirement                        | Rspack's answer                                                |
| :--------------------------------- | :------------------------------------------------------------- |
| Hot-update hook with changed file  | `compiler.hooks.watchRun` + `compiler.modifiedFiles`           |
| **Monotonic per-event sequence**   | `Watching.startTime` — the host's clock, per the warning above |
| **`read()` for that event**        | `compiler.inputFileSystem`, purged per watch run               |
| Module-graph access + invalidation | **Not needed in this shape** — see below                       |
| Per-module token reaching client   | `<chunk>.<hash>.hot-update.js`, entirely the host's            |
| Server→client channel              | `RsbuildDevServer.sockWrite("full-reload")`                    |

The fourth row is the correction. It assumes a host that _asks_ what to invalidate, because Vite does: its hot-update hook hands over an event and takes back a module list. Rspack asks nothing — it rebuilds whatever its own dependency graph says is stale, so a generated catalog that declares no dependencies is never stale however loudly a hook shouts. The equivalent capability there is not "invalidate these modules" but **"declare what this generated module is derived from"**, which Zintl does through `getBoundaryInputs()` → `watchedFiles` → `addWatchFile`.

So read that row as _either_ per-module invalidation _or_ declared file dependencies, whichever the host actually acts on. `BundlerFacet.dependencyInvalidation` is how a facet says which. Declaring both is not belt-and-braces: on a host that already honours an explicit invalidation list, declaring the catalogs as dependencies too makes Zintl's own `flush()` writes re-enter as source changes.

---

## §8 — Production Cost

Zintl's zero-runtime guarantee is load-bearing in how the project describes itself, and the runtime is the one place where bytes are visible to a user.

| Ships to production        | Development only                  |
| :------------------------- | :-------------------------------- |
| `subject`                  | the ledger and its ring           |
| `seq`                      | `cause`, `reason`                 |
| the D1 receiver comparison | every outcome report and log line |
|                            | the settle beacon                 |

**Verification is mechanical.** No ledger identifier may appear in any built client bundle. This is checked two ways: by grep across the example applications' built assets, and — automatically — by the committed build-output snapshots, which turn any newly leaked identifier into a snapshot diff.

**Substitution constraint.** `getRuntimeCode()` resolves `__ZINTL_DEV__` with a regular-expression text replacement over the runtime module's source before it is served. Any bus code in the runtime must survive verbatim textual substitution — the sentinel may not appear nested inside a template literal in a position the replacement would corrupt.

---

## §9 — Testing Contract

The bus is the synchronization primitive. A harness waits on a **delivered sequence**, not on a counter, a packet type, or an elapsed interval.

### §9.1 — Causal waiting

After a mutation, the harness reads the generation the compiler stamped and waits until the page's ledger shows a `runtime/catalog` delivery at least that new. That is a causal chain from the write to the applied catalog.

It replaces waiting on the first packet of a given _type_, which is identity-free: it resolves on any update, including one caused by a concurrent test in another worker.

Corollary D2a is what makes it possible. Until an idempotent update produces an outcome, no causal wait can distinguish "applied, unchanged" from "lost", and a correct no-op is indistinguishable from a stall.

**A causal wait must report why it finished.** Three outcomes, not two: _delivered_, _unavailable_ (nothing to gate on — no live compiler, or a production page with no ledger), and _timed out_. Collapsing the last two is expensive in both directions: a wait that reports success when it did nothing is the failure mode that made the old heuristic untrustworthy, and a caller that falls back after already spending its budget spends it twice on every mutation.

**Where no sequence travels with the catalog** — an app whose catalogs arrive through the manager's loader rather than a generation-stamped content module — the wait cannot be satisfied at all. Probe once and remember the answer, rather than paying the timeout on every mutation; a contract performing twenty edits is the difference between passing and not.

### §9.2 — Strict delivery

Strict mode turns a missing or non-terminal outcome into a hard failure rather than a silent fall-through to a timing heuristic.

Some contracts deliberately break the application and **must** be exempt: a syntax error _should_ stall the runtime, and a deleted or corrupted catalog _should_ fail to apply. Exemption is **declared on the contract**, alongside its capability requirements — not inferred, not passed by an environment variable, not decided per call site.

| Contract          | Exempt because                                                                |
| :---------------- | :---------------------------------------------------------------------------- |
| `syntax-recovery` | introduces a deliberate compile error; the intermediate write must not settle |
| `chaos-catalog`   | deletes and corrupts catalogs; the runtime legitimately cannot apply them     |
| `chaos-boundary`  | deletes and renames boundary sources                                          |

### §9.3 — Heuristics

Timing heuristics may remain only as a **declared fallback**, never on a success path. A heuristic that runs unconditionally after a causal wait re-introduces the imprecision the causal wait was built to remove, and hides how much of the suite is genuinely synchronized.

---

## §10 — Conflict Resolution Summary

| Scenario                                   | Resolution                                                           | Axiom    |
| :----------------------------------------- | :------------------------------------------------------------------- | :------- |
| Two updates for one subject, out of order  | Higher `seq` wins; the other is `superseded`                         | D1       |
| Redelivery at the same `seq`               | `superseded` — carries no new information                            | D1       |
| Update applied but content identical       | `applied` — a no-op is still an outcome                              | D2a      |
| Work in flight when a newer update arrives | Let it complete; discard by D1                                       | D1, §4.2 |
| Two requests coalesced into one stage run  | Subjects adopted; the later request is `superseded`                  | D3       |
| Catalog load fails, empty, or throws       | `failed` with a reason; **no retry, no fallback**                    | D2, §6   |
| Locale switch lands mid-load               | Captured locale wins; the mutable field is never read after an await | §4.4     |
| Two facets claim one hook at equal rank    | **Hard error at construction**                                       | D4       |
| Two facets contribute colliding keys       | Declared composition decides; undeclared is a violation              | D4       |
| An output survives its source              | Its owning generation is superseded; it is reclaimable               | D3, §3   |

---

## §11 — Glossary

**Envelope** — the unit of governed delivery: identity, sequence, outcome.

**Channel** — a namespace of comparable work. Ordering never crosses one.

**Subject** — the supersession key. Two envelopes sharing a subject describe the same thing at different times.

**Custody** — the obligation to drive an envelope to a terminal outcome. It is inherited by whoever coalesces, never dropped.

**Supersession** — being overtaken by a higher sequence. A normal, named outcome, not a failure.

**Ledger** — the development-only bounded record of envelopes and outcomes. Diagnosis, never correctness.

**Settle beacon** — the pre-existing development-only counter the runtime advanced on every store notification. Under ZDB it is derived from the ledger's `applied` count and retained for compatibility.

---
