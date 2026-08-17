/**
 * The reference workload every benchmark suite calibrates against.
 *
 * ## Why this is not a `Math.sin` loop
 *
 * It used to be one, and the budgets it scaled were unreliable because of it.
 * A tight scalar-arithmetic loop stays in L1, allocates nothing and never
 * provokes the collector, so it measures a core's clock and very little else.
 * The workloads it was scaling — transform a module, reconcile a catalog,
 * regenerate a manager — are allocation-heavy, string-heavy and GC-bound.
 *
 * Measured: on one machine, between the day the budgets were recorded and a day
 * six weeks later, `Structural HMR Latency` went from 0.2139 ms to 0.44 ms and
 * `Colony HMR Latency` from 0.4124 ms to 0.75 ms — **on identical code**,
 * verified by running the original commit in a worktree. Over the same interval
 * the `Math.sin` loop reported the machine 5–15% slower. It under-reported a 2×
 * change by more than an order of magnitude, so budgets scaled by it drifted out
 * from under the benchmarks and the gate began failing on machine state.
 *
 * ## What it does instead
 *
 * The same *kinds* of work the compiler does — build strings, intern them in a
 * Map, sort, serialize, scan. It is deliberately **not** product code: a
 * calibration made of the thing under test moves with a regression and hides it.
 * This lives in `scripts/` and imports nothing, so its cost is a property of the
 * machine and of nothing else.
 *
 * ## Why the working set is 600 and not 48
 *
 * Because the size matters as much as the shape, which was not obvious until it
 * was measured. At 48 entries this was allocation-shaped but tiny: every string
 * died in the nursery, the heap never grew, and no page was ever touched that
 * was not already resident. It tracked the compiler benchmarks reasonably and
 * missed `Extract Long File (200 keys)` completely — that one builds a large
 * native AST, so on a machine with no free memory it pays page-fault costs this
 * function never saw. Its normalised ratio still swung 3.1× between runs.
 *
 * At 600 the working set is large enough to feel the same pressure, and that
 * swing is 9%. Across the whole suite, ratio spread went from 54–121% to 1–9%.
 *
 * ## Changing it
 *
 * Editing this function invalidates every ratio in `REFERENCE_RATIOS`
 * (`scripts/budget-reporter.ts`), because all of them are defined relative to
 * it. Re-record them together, in one run, or the relationship the whole
 * mechanism rests on is broken.
 */
/**
 * The bench name, shared so the reporter and the suites cannot drift apart.
 *
 * They previously agreed by coincidence: the reporter declared a constant for
 * this and then matched a duplicated string literal a few lines below it.
 */
export const CALIBRATION_BENCH_NAME = "Reference Calibration (Workload)";

export function calibrationWorkload(): number {
  const catalog = new Map<string, string>();

  for (let i = 0; i < 600; i++) {
    const key = `b_${(i * 2654435761) % 99991}_message_${i}`;
    const value = `<p>Translated content ${i} with an <code>inline</code> tag and a {placeholder}</p>`;
    catalog.set(key, value.replace("{placeholder}", String(i)).slice(0, 96));
  }

  const entries = [...catalog.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const json = JSON.stringify(Object.fromEntries(entries));

  let checksum = 0;
  for (let i = 0; i < json.length; i += 7) {
    checksum += json.charCodeAt(i);
  }
  return checksum;
}

/**
 * Accumulator the benches add into, so the workload cannot be optimised away.
 *
 * Exported and mutated rather than kept local, because a value V8 can prove is
 * unobserved is a value it is entitled to stop computing.
 */
export const calibrationSink = { total: 0 };
