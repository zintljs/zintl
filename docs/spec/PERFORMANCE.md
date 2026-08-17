# Zintl Performance Constitution

Zintl is architected for "Light Speed" internationalization, and the way we keep
it that way is a gate in CI. This document is about what that gate actually
asserts, because for a while it asserted something other than what it claimed.

## Budgets are relative, not absolute

A budget here is **a multiple of a calibration workload measured in the same
run**, not a number of milliseconds, and it is compared on **p75** rather than
the mean. `Structural HMR Latency: 0.45` reads "three runs in four this costs at
most 0.45× what `scripts/bench-calibration.ts` costs on this machine", and the
gate fails when it exceeds that by more than the headroom.

That is the whole design, and it is worth understanding why it is not the obvious
one. A millisecond ceiling describes the machine that recorded it. It keeps
describing that machine, and stops describing anything else, the moment the
hardware or its condition changes — and then the gate reports "the code got
slower" when what happened is "the laptop filled its swap".

A ratio survives that, because both halves move together.

## What went wrong, and why the mechanism changed

The budgets used to be absolute milliseconds, scaled by a calibration benchmark.
The scaling was the right idea. The calibration was a `Math.sin` loop.

A tight scalar-arithmetic loop stays in L1, allocates nothing and never provokes
the collector, so it measures a core's clock and very little else. The workloads
it was scaling — transform a module, reconcile a catalog, regenerate a manager —
are allocation-heavy, string-heavy and GC-bound. The two do not move together at
all.

Measured on 2026-08-15: `Structural HMR Latency` read 0.44 ms against a recorded
baseline of 0.2139 ms, and `Colony HMR Latency` 0.75 ms against 0.4124 ms. That
looked like a 2× regression. It was not — building the commit the baseline was
recorded from, in a worktree, on the same machine, in the same sitting, gave the
same slow numbers. The machine had **14 GB of 15 GB swap in use** after 20 days
of uptime, and every allocation-heavy path was paying page-fault costs. Over the
same interval, the calibration loop reported the machine 1.00× slower.

So the gate failed on swap pressure and blamed the code, and the mechanism built
to prevent exactly that could not see it.

Two things changed:

- **The calibration workload allocates, at scale.** `scripts/bench-calibration.ts`
  builds strings, interns them in a `Map`, sorts, serializes and scans — the same
  kinds of work the compiler does, deliberately _not_ the compiler's own code,
  since a calibration made of the thing under test moves with a regression and
  hides it.

  The **size** of its working set turned out to matter as much as the kind of
  work. A first attempt allocated 48 short-lived strings per iteration: enough to
  be allocation-shaped, small enough that all of them died in the nursery and the
  heap never grew. It tracked the compiler benchmarks reasonably and missed
  `Extract Long File (200 keys)` entirely — that one builds a large native AST
  and pays page-fault costs the calibration never saw, so its ratio still swung
  3.1× run to run. At 600 entries the calibration feels the same pressure and
  that swing is 9%. Across the suite, ratio spread went from 54–121% to 1–9%.

- **Budgets became ratios.** There is no longer a second constant that has to be
  recorded in the same breath as the budgets and silently didn't.
- **The comparison moved to p75.** A latency mean is decided by its worst
  samples. Observed on one run, `Fast-Path (No Translations/Sinks)` reported mean
  0.1183 ms, p75 0.0549 ms and max 16.3 ms: two stalled iterations moved the mean
  by 2.2× and failed the gate, while p75 sat at 0.90× its budget. A budget should
  assert what something costs most of the time, not what the OS did to it once.

## What the gate can and cannot absorb

It absorbs a uniformly slower machine, which is the common case: a loaded CI
runner, a laptop on battery, a colleague's older hardware.

It does **not** absorb contention that hits the benchmarks harder than it hits
the calibration. Measured: under six processes churning allocations, the
calibration rose 5× while `Colony HMR Latency` rose 24×, because that benchmark
writes to disk on every iteration and the calibration does not. The gate fails
there, and it should — but the failure is about the machine, so the reporter
prints the calibration reading and says to check `sysctl vm.swapusage` and
background load before chasing the code.

It also matters _when_ the benchmark runs. `vpr ready` deliberately runs it
**second**, straight after the package build and before the example builds, the
lint and the test suite: measured last, on the machine those leave behind, the
same benchmark reads 3.4 ms where it reads 0.5 ms run early. Nothing normalises
away measuring during another job's cooldown.

The residue worth knowing about: `Catalog Serialization Logic` and
`Colony HMR Latency` both perform real filesystem writes inside the measured
region. That is the largest remaining source of variance in the suite and it is
not calibrated away by anything.

## Re-recording the budgets

`scripts/budget-reporter.ts` holds `REFERENCE_RATIOS` and one `HEADROOM`
constant. To re-record:

1. Run `vpr bench` on an **unloaded** machine — check swap first.
2. Divide each benchmark's p75 by the `Reference Calibration (Workload)` p75
   **from the same run**.
3. Store that ratio, without headroom. `HEADROOM` applies it once, in one place.

Take the lowest ratio across several runs: ambient load only ever adds time, so
the floor is the closest available estimate of the intrinsic cost, and
`HEADROOM` is what covers everything above it.

> [!IMPORTANT]
> The committed ratios were recorded on a machine with 14 GB of 15 GB swap in
> use. That is deliberate rather than a compromise — a ratio is supposed to hold
> there and on a healthy CI runner alike, and one recorded under pressure is the
> harder test of whether it does.

Editing `calibrationWorkload()` invalidates every ratio, because they are all
defined against it. Re-record them together or not at all.

## Gating system

A custom Vitest reporter, [budget-reporter.ts](../../scripts/budget-reporter.ts).

1. **Reporting**: standard Vitest output shows Hz, percentiles and deltas.
2. **Enforcement**: if a benchmark's **mean** exceeds `ratio × HEADROOM ×
calibration`, the reporter exits non-zero.
3. **Missing calibration is a hard failure**, rather than every budget being
   compared against zero and reporting eight meaningless violations.

## Commands

| Command               | What it does                                                                       |
| :-------------------- | :--------------------------------------------------------------------------------- |
| `vpr bench`           | Runs the suite and enforces the budgets. This is what `vpr ready` and CI run.      |
| `vpr run bench:write` | The same, plus rewrites `bench-baseline.json` and emits perf changesets for drift. |

`bench-baseline.json` feeds the changeset comparison only — it is not what the
gate checks against. Its deltas are normalised by the calibration figure recorded
beside them, on the same principle as the budgets.

## Optimization strategy

To maintain these speeds, Zintl uses:

1. **Stable hashing**: files are only re-processed if their semantic content changes.
2. **Boundary memoization**: transform results are cached at the module level.
3. **AST short-circuiting**: the extractor skips work when no `zintl` or template-literal patterns are present.
