# Proposal 024: The Delivery Bus — Update Ordering and Failure Surfaces

## Status: PROPOSAL

**Date**: 2026-08-01
**Supersedes**: nothing. **Depends on**: the settle beacon (`__zintl_version`), shipped with the `__ZINTL_DEV__` sentinel.

---

## 0. How to read this

This proposal is written for whoever picks up the event-bus work. It records **what was measured**, not what was assumed — every claim below either has a reproduction attached or is explicitly labelled a hypothesis.

The temptation with a bus is to design the abstraction first. Resist it. The evidence points at three specific defects, and the right bus is the smallest one that makes those three impossible. Build the bus the bugs demand.

---

## 1. Context: what went wrong, with evidence

Three defects were observed. They look unrelated and are not.

### 1.1 A later update loses to an earlier one

The clearest failure. `hmr-hammer` writes five times in sequence — `Hammer 1` … `Hammer 4`, then the final text — and the DOM settles on an **intermediate** value.

```
expected 'Hammer 3' to contain 'HMR Hammer works!'

hmr packets:      {"update": 5}     ← the server sent an update per write
settle beacon:    11                ← the runtime applied updates
console errors:   none              ← nothing failed
body html length: 2538              ← the page is healthy
```

Read that carefully, because it eliminates most explanations:

- The dev server **did** send five updates. Not a watcher problem.
- The runtime **did** apply updates. Not a transport problem.
- Nothing threw, nothing logged, the page rendered fine. Not a crash.

And the DOM is two versions behind. Delivery works; **ordering does not**. Nothing in the pipeline guarantees that the last write wins.

Observed as `'Hammer 3'` and `'Hammer 4'` on different runs — the specific version it settles on varies, which is what a race looks like.

#### 1.1a A second signature: the update is never sent

A later CI run of the same contract failed differently, and the difference is load-bearing:

```
expected 'Hammer 4' to contain 'HMR Hammer works!'

hmr packets:      {"update": 4}    ← FOUR packets, for FIVE writes
settle beacon:    9
console errors:   none
selector h1 html: Hammer 4         ← the last state that WAS sent
```

`hmr-hammer` performs five writes (`Hammer 1`, then `2`–`4` at 30 ms intervals, then the final text). This run produced **four** packets, and the DOM settled on `Hammer 4` — the newest state the wire actually carried. The file on disk held the final text; no packet ever described it.

Contrast with §1.1, where five packets were sent and the browser still ended up two versions behind.

**The two signatures place the loss in different components:**

|       | packets         | DOM lands on  | loss is                              |
| :---- | :-------------- | :------------ | :----------------------------------- |
| §1.1  | 5 (all sent)    | 2 behind      | downstream of arrival — ordering     |
| §1.1a | 4 (one missing) | last one sent | upstream of the wire — never emitted |

Packet accounting is inferential — the counts are totals, not a per-write mapping — so treat "the fifth write emitted nothing" as strongly indicated rather than proven. But the conclusion holds either way: **a design that only orders updates after they arrive would not have fixed §1.1a.** Whatever guarantees the bus provides must extend back to the point where a filesystem change becomes an update, not begin at the point where one is received.

Practically, that means the write→emit path (watcher coalescing, debounce windows, whatever swallows a change under rapid succession) needs auditing before the ordering work is called complete.

### 1.2 A boundary can be abandoned in silence

`_t()` returns `""` when a key is missing, in three separate places. Before returning, it fires a catalog load and forgets it:

```ts
void Promise.resolve().then(() => instance.loadLazyBoundary(mgr.id, mgr.loader));
```

`loadLazyBoundary` then discarded every failure it could have: a rejected promise, an empty result, and a synchronous throw. Each cleared `pendingBoundaries` and scheduled **no retry**.

The consequence: once delivery failed, that boundary rendered blank _permanently_, and nothing anywhere recorded it. The three sites now log in development (see §3), but logging is not a fix — there is still no retry and no ordering.

### 1.3 A full reload can leave the app unmountable

```
hmr packets:   {"full-reload":5,"update":5,"prune":1}
settle beacon: ABSENT — no Zintl runtime on the page
console errors: ReactDOMClient.createRoot() on a container that has already
                been passed to createRoot()
body html:     103 chars, no buttons, no text
```

The entry module re-executed after a `full-reload` and called `createRoot` on an already-rooted container. The page is dead — 103 bytes.

Note `full-reload: 5` alongside `update: 5`. Worth establishing whether Zintl is requesting full reloads where an accept/dispose would be correct; a full reload that re-executes an entry without disposing the previous mount is a lifecycle bug regardless of ordering.

### 1.4 The common shape

All three are the same missing thing: **updates are fire-and-forget, with no identity, no ordering, and no failure surface.** A message is sent, and whether it arrives, arrives late, arrives twice, or arrives out of order is nobody's responsibility.

The author's own account matches this precisely, and predates the measurements:

> "some changes get trapped for a little moment, and a very little ones just shock the system and live for ever in a disk category or on one of the outputs"

That last clause matters — it says the same class of problem shows up in **write paths** (artifacts outliving their source), not only in the browser. A bus scoped only to HMR would fix half of it.

---

## 2. Why "add retries" is the wrong fix

The obvious patch is to retry a failed load and to debounce rapid updates. Both make the symptoms rarer and neither addresses the defect.

- A retry cannot fix ordering. Re-delivering an out-of-order update produces the same wrong final state.
- Debouncing hides the race behind a timing window that is correct on a fast machine and wrong under load — the same mistake as the `waitForIdle` heuristic the test harness was built on, which produced years of unfalsifiable flakes.
- Neither gives a failure a name. A silent abandonment stays silent.

The system does not need to try harder. It needs to know **what it is delivering, in what order, and whether it landed.**

---

## 3. What already exists (use it)

Non-obvious, and all shipped:

**`globalThis.__zintl_version`** — the settle beacon. Incremented on every `notify()`, so it advances whenever the store applies a locale change or catalog. Development-only, eliminated from production by `__ZINTL_DEV__`. It is the only causal "something settled" signal in the system.

**`__ZINTL_DEV__`** — a build-time sentinel substituted to a literal by `getRuntimeCode()`. Any dev-only bus instrumentation should gate on this, and **not** on `typeof process !== "undefined"`, which is unfoldable and evaluates false in browsers. That idiom silently disabled every dev branch in the runtime for the project's entire life.

**`LabWebSocket.recentPackets`** — a rolling log of what the dev server actually pushed, independent of any capture. Answers "was it sent?" after the fact.

**Contract failure diagnosis** — every contract failure attaches HMR packet counts by type, the beacon value, console errors, and the DOM state. This is what turned "flaky test" into the evidence in §1.

**`ZINTL_STRICT_SETTLE=1`** — turns a missing or stalled beacon into a hard failure instead of a silent fallback. Running the suite under it lists every contract lacking causal synchronisation. Expect `syntax-recovery` to fail legitimately: a syntax error _should_ stall the runtime, so strict mode needs a per-contract opt-out.

**Reproduction:** the failures in §1 appear in roughly one full-suite run in five, under four workers. `memory-leak` and `chaos-catalog` in isolation did not reproduce in six attempts — concurrency is part of the trigger.

---

## 4. Design direction

### 4.1 What a delivered update needs

Minimally, three properties. This is the whole idea:

| Property                                     | Answers                         | Fixes                    |
| :------------------------------------------- | :------------------------------ | :----------------------- |
| **Identity** — what changed                  | which boundary, which locale    | duplicate/redundant work |
| **Sequence** — a monotonic number            | is this newer than what I have? | §1.1 ordering            |
| **Outcome** — applied, superseded, or failed | did it land?                    | §1.2 silence             |

A receiver holding the sequence number it last applied can discard anything older. That single rule makes §1.1 structurally impossible rather than unlikely — which is the bar, given the failure is a race.

### 4.2 Where the seam sits

The runtime already has the choke point: **`notify()`**. Every locale change and catalog application passes through it, which is exactly why the settle beacon lives there and works. A bus that owns dispatch is a generalisation of what `notify()` already is, not a new layer beside it.

§1.1 shows the transport delivering correctly with the loss downstream of arrival, which argues for starting at `notify()`. §1.1a shows a write that never became a packet at all, which argues the guarantee has to reach further back.

Both are true, so scope the _guarantee_ end to end — a change on disk is accounted for until it is applied or explicitly superseded — while implementing it incrementally. Starting at `notify()` is still the right first move, because it is the choke point that already exists; just don't mistake a green `hmr-hammer` after that step for the whole problem being solved.

### 4.3 Scope discipline

The author's motivation includes build-time artifacts that outlive their sources. That is a real problem and probably the same shape. It is **not** the same subsystem, and doing both at once risks an abstraction that serves neither.

Recommended order:

1. **Runtime update ordering** (§1.1). Smallest, best-evidenced, structurally fixable.
2. **Failure outcomes** (§1.2). Falls out of the same envelope.
3. **HMR lifecycle** (§1.3). Diagnosed already; may not need the bus at all.
4. **Build-time artifact ordering.** Only after 1–3 show what the abstraction should be.

### 4.4 Production cost

The runtime is the one place where bytes matter — Zintl's zero-runtime guarantee is load-bearing in its pitch. Sequence numbers and identity are cheap and belong in production. Tracing, history, and outcome reporting are development-only and must gate on `__ZINTL_DEV__`.

Verify with the existing check: no bus identifier should appear in any `examples/*/dist/assets/*.js`. That check is already how `__zintl_version` was confirmed absent from client bundles.

---

## 5. Acceptance criteria

Non-negotiable, because they are the defects:

1. **`hmr-hammer` cannot settle on an intermediate value.** Not "rarely does" — the final write must win by construction. Demonstrate by reasoning about the mechanism, not by a green run.
2. **An abandoned boundary is observable.** A catalog that fails to arrive produces a named failure, not a blank element.
3. **Under `ZINTL_STRICT_SETTLE=1`**, every contract that should have causal synchronisation passes, with documented per-contract exemptions for those that deliberately break the app (`syntax-recovery`, `chaos-*`).
4. **Production bundles are unchanged in size beyond identity and sequence.** Verified by grep against `dist`.
5. **Five consecutive full-suite runs at `retry: 0`, zero failures.** The suite is already there — this is the regression bar the current code meets.

## 6. Open questions

- **Sequence scope**: global, per-boundary, or per-locale? Per-boundary is the smallest thing that fixes §1.1; global is simpler to reason about and may fold in §1.3.
- **Superseded work**: cancel an in-flight load when a newer update arrives, or let it complete and discard the result? Cancellation is cleaner and harder.
- **SSR**: the store is request-scoped via `AsyncLocalStorage`, but the settle beacon is process-global. A bus carrying state needs to decide which it is, and get it right the first time — process-global mutable state under SSR is the classic source of cross-request leakage.
- **Does §1.3 need the bus at all?** It may be a plain accept/dispose fix. Worth trying independently before assuming the bus subsumes it.

## 7. Do not repeat these mistakes

Learned expensively during the investigation that produced this document:

- **A guard the bundler cannot fold is not a guard.** `typeof process !== "undefined" && …` disabled every dev branch in the browser, permanently and invisibly.
- **A silent fallback and a working signal are indistinguishable.** Instrument the degraded path, or it will be trusted when it should not be.
- **Measure on a quiet machine.** An early cycle produced escalating failures that were pure resource starvation from leaked browsers. That data was worthless and nearly sent the investigation after a phantom.
- **A negative result is a result.** The instrumentation in §1.2 was built expecting to catch the §1.1 failure. It stayed silent, which is what _eliminated_ delivery failure as the cause and pointed at ordering. Instrument to falsify, not to confirm.
