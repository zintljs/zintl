import { basename } from "node:path";
import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

/**
 * Measured wall-clock cost of each contract file, in seconds, at
 * `maxWorkers: 4` on a warm checkout.
 *
 * This exists because **Vitest shards by SHA1 of the file path.** That is the
 * right default — it needs no history and it is stable across machines — but it
 * is blind to cost, and this suite's costs span three orders of magnitude
 * (`hmr` at 158 s, `multiplex-fence` at 0.14 s). Measured, a hash-based
 * three-way split produced 149 s / 65 s / 119 s: the slowest shard decides the
 * matrix, so a third of the machines' time was bought and thrown away.
 *
 * The numbers are a *scheduling hint*, not a budget, and nothing asserts on
 * them. They can drift a long way before the schedule gets worse than the hash
 * it replaced — what matters is the ordering, not the absolute values. Refresh
 * them when the shape of the suite changes (a contract added, a project added
 * to many contracts), not when one gets 10% faster:
 *
 *   vp test --config=tests/vitest.config.ts --reporter=json --outputFile=/tmp/t.json
 *
 * A file missing from this table is treated as {@link DEFAULT_WEIGHT} and
 * scheduled first, so a newly added contract is never the thing discovered at
 * the end of the slowest shard.
 */
const WEIGHTS: Record<string, number> = {
  hmr: 158,
  "performance-hmr": 121,
  "syntax-recovery": 106,
  "hmr-sink": 92,
  "chaos-catalog": 90,
  "hmr-first-tick": 78,
  "catalog-edit": 73,
  "boundary-graph": 63,
  "locale-switch": 63,
  "memory-leak": 63,
  "locale-bar": 59,
  "hmr-growth": 52,
  "initial-render": 51,
  "hmr-hammer": 46,
  "delivery-refresh": 40,
  build: 38,
  "chaos-boundary": 33,
  "delivery-failure": 32,
  "asset-hmr": 30,
  "hmr-sink-warm": 28,
  "locale-storm": 18,
  "facet-composition": 15,
  "delivery-ordering": 14,
  hydration: 8,
  "hmr-server-refresh": 6,
  "ssr-isolation": 6,
  "transform-dev": 6,
  assets: 4,
  "performance-size": 4,
  "transform-prod": 3,
  graph: 2,
  "multiplex-fence": 0.2,
};

/**
 * What an unmeasured file is assumed to cost.
 *
 * Deliberately above the median rather than at it. Guessing low hides a new
 * contract at the tail of whichever shard it lands in, and the tail is the one
 * position where a wrong guess costs the whole matrix; guessing high only
 * shuffles it earlier.
 */
const DEFAULT_WEIGHT = 90;

function weightOf(spec: TestSpecification): number {
  const name = basename(spec.moduleId).replace(/(\.contract)?\.spec\.ts$/, "");
  return WEIGHTS[name] ?? DEFAULT_WEIGHT;
}

/** Heaviest first, ties broken by path so the order never depends on globbing. */
function byCostDescending(a: TestSpecification, b: TestSpecification): number {
  const diff = weightOf(b) - weightOf(a);
  return diff !== 0 ? diff : a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0;
}

/**
 * Assign contract files to shards by measured cost instead of by path hash.
 *
 * Greedy longest-processing-time bin packing — take the heaviest file still
 * unplaced, give it to the lightest shard — which for this distribution lands
 * within 1 s of a perfect split at every shard count from 2 to 6. Deterministic:
 * every machine sorts the same list the same way and computes the same
 * partition, so no coordination is needed and every file lands in exactly one
 * shard.
 *
 * **`sort` is deliberately inherited, not overridden.** Overriding it to run
 * longest-first is the textbook makespan answer and it made the suite worse
 * here: it starts all four workers on the four heaviest files at once, which is
 * the busiest window the run ever has, and `performance-hmr` — which asserts
 * latency budgets — drew its neighbours from that window and failed on
 * `rsbuild-react-basic` with a hot-update chunk left unanswered. A suite
 * containing performance contracts cannot be scheduled purely for throughput.
 * `BaseSequencer.sort` stays, so the order inside one machine is exactly what it
 * was before this file existed, and the only thing that changed is which
 * machine gets which file.
 */
export default class ContractSequencer extends BaseSequencer {
  async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    // Vitest only calls `shard` when `--shard` was passed, but a sequencer that
    // returns everything when it was not is the safe shape: the alternative is
    // an unsharded run silently losing two thirds of its tests.
    if (!shard) return specs;
    const { index, count } = shard;

    const bins = Array.from({ length: count }, () => ({
      cost: 0,
      specs: [] as TestSpecification[],
    }));
    for (const spec of [...specs].sort(byCostDescending)) {
      const lightest = bins.reduce((min, bin) => (bin.cost < min.cost ? bin : min));
      lightest.cost += weightOf(spec);
      lightest.specs.push(spec);
    }

    return bins[index - 1].specs;
  }
}
