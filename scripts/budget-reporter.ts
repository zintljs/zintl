/**
 * Zintl Performance Budget Reporter
 *
 * A custom Vitest benchmark reporter that fails the run when a benchmark costs
 * more than its share of the machine it ran on.
 *
 * Budgets are **relative**: each one is a multiple of the calibration workload
 * in `scripts/bench-calibration.ts`, measured in the same run. That is the whole
 * design — an absolute millisecond ceiling describes the machine that recorded
 * it, and stops describing anything the moment the machine changes. See
 * {@link REFERENCE_RATIOS} for what that cost the project before it was fixed.
 *
 * Usage: configured in `vite.config.ts` under `test.benchmark.reporters`.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CALIBRATION_BENCH_NAME } from "./bench-calibration.js";

/**
 * Ceilings expressed as **multiples of the calibration workload**, not as
 * milliseconds, and compared on **p75** rather than the mean.
 *
 * `Structural HMR Latency: 0.45` reads "three runs in four, this costs at most
 * 0.45× what `scripts/bench-calibration.ts` costs on the same machine, in the
 * same run", and {@link HEADROOM} decides how far past that is a failure. A
 * ratio is a property of the code; a millisecond figure is a property of the
 * machine that produced it, and this file used to store the latter.
 *
 * ## Why p75 and not the mean
 *
 * A latency mean is decided by its worst samples. Observed on one run:
 * `Fast-Path (No Translations/Sinks)` reported **mean 0.1183 ms, p75 0.0549 ms,
 * max 16.3 ms** — a couple of stalled iterations, almost certainly a collection
 * pause, moved the mean by 2.2× and failed the gate. The p75 of that same run
 * was 0.90× its budget. Nothing about the code was different.
 *
 * p75 is what a latency budget should assert anyway: not "the average including
 * whatever the OS did to us", but "this is what it costs, most of the time".
 *
 * ## Why the unit changed
 *
 * The budgets were absolute times plus a `GOLDEN_REFERENCE` to scale them by,
 * and the two had to be recorded together to mean anything. They were not: the
 * budgets were set once, and six weeks later, on the same laptop,
 * `Structural HMR Latency` measured 0.44 ms against a recorded 0.2139 ms and
 * `Colony HMR Latency` 0.75 ms against 0.4124 ms — **on identical code**,
 * verified by building the original commit in a worktree and running it beside
 * the current one. The machine had 14 GB of 15 GB swap in use, and every
 * allocation-heavy path was paying for it.
 *
 * The calibration should have absorbed exactly that, and could not: it was a
 * `Math.sin` loop, which stays in L1, allocates nothing and never provokes the
 * collector. It reported the machine 1.00× while the real workloads had halved
 * in speed. So the budgets did not move, and the gate failed on swap pressure
 * while reporting a performance regression that did not exist.
 *
 * Two changes came out of that. The calibration workload now allocates a working
 * set large enough to touch fresh pages, builds strings, sorts and serializes,
 * so it degrades with the resources these benchmarks actually depend on. And the
 * budgets are ratios, so there is no second number to keep in step and nothing
 * to silently drift apart from.
 *
 * The working-set size turned out to matter as much as the kind of work. A first
 * attempt allocated 48 short-lived strings per iteration — enough to be
 * allocation-shaped, small enough that every one of them died in the nursery
 * without the heap ever growing. It tracked the compiler benchmarks reasonably
 * and missed `Extract Long File (200 keys)` completely, which builds a large
 * native AST and so pays page-fault costs the calibration never saw: that
 * benchmark's ratio still swung 3.1× run to run. At 600 entries the calibration
 * feels the same pressure, and the same benchmark swings 9%.
 *
 * ## Re-recording
 *
 * Run `vp run bench` on an **unloaded** machine and divide each mean by the
 * `Reference Calibration (Workload)` mean from the same run. Store that ratio
 * here — without headroom, which {@link HEADROOM} applies once, in one place.
 *
 * These were recorded as the median of three consecutive runs on 2026-08-15, on
 * a machine with 14 GB of 15 GB swap in use — which is a worse machine than any
 * CI runner, and is the point: the ratios are supposed to be the same there.
 * Their spread across those runs was 1–9%.
 */
const REFERENCE_RATIOS: Record<string, number> = {
  // --- Compiler Pipeline ---
  "Hot HMR Latency (Warm Path)": 0.0024,
  "Structural HMR Latency (Patch Path)": 0.45,
  "Catalog Serialization Logic": 0.48,
  "Colony HMR Latency (Manager Sync)": 0.82,

  // --- Extractor & Fast-Path ---
  "Extract Short File": 0.051,
  "Extract Long File (200 keys)": 2.35,
  "Fast-Path (No Translations/Sinks)": 0.037,
  "Fast-Path (Non-UI Logic)": 0.0007,
};

/**
 * How much worse than its reference ratio a benchmark may run before failing.
 *
 * **This has to exceed the machine-induced spread of the ratios themselves, or
 * the gate fails on hardware rather than on code.** Normalising against a
 * workload-shaped calibration and comparing on p75 take that spread down to
 * 1–9% in ordinary conditions, which is what makes 2.0 a usable number rather
 * than the aspiration the old 1.87× turned out to be.
 *
 * It is deliberately not tighter. The residue that normalisation cannot reach is
 * `Catalog Serialization Logic` and `Colony HMR Latency` performing real
 * filesystem writes inside the measured region: under four processes churning
 * allocations, those two ran 3.3× and 10× their reference while every other
 * benchmark stayed within 2%. Taking that I/O out of the measured region is what
 * would earn a tighter gate — not a smaller constant here.
 */
const HEADROOM = 2.0;

const PERF_CHANGESET_DIR = ".changeset";
const REFERENCE_CALIBRATION_BENCHMARK_NAME = CALIBRATION_BENCH_NAME;

interface BenchmarkResult {
  name: string;
  rank: number;
  mean: number;
  hz: number;
  min: number;
  max: number;
  p75: number;
  p99: number;
  p995: number;
  p999: number;
  rme: number;
  sampleCount: number;
}

interface Task {
  id: string;
  name: string;
  type: string;
  meta: { benchmark?: boolean };
  result?: {
    state?: string;
    benchmark?: BenchmarkResult;
  };
  tasks?: Task[];
}

interface TestModule {
  task: Task & { file: any };
}

// Vitest Reporter interface (minimal)
export default class BudgetReporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    const violations: string[] = [];
    const passes: string[] = [];

    // 1. Find the calibration benchmark to calculate scaling factor
    let referenceP75s: number[] = [];
    const findCalibration = (tasks: Task[]) => {
      for (const t of tasks) {
        if (t.name === REFERENCE_CALIBRATION_BENCHMARK_NAME && t.result?.benchmark) {
          referenceP75s.push(t.result.benchmark.p75);
        }
        if (t.tasks) findCalibration(t.tasks);
      }
    };

    for (const mod of testModules) {
      if (mod.task.tasks) findCalibration(mod.task.tasks);
    }

    /**
     * 2. The scale for this run.
     *
     * Every budget is a multiple of this number, so there is nothing else to
     * calibrate against and nothing to keep in step. A machine twice as slow
     * produces a calibration twice as large and every budget moves with it.
     */
    const calibrationMean = referenceP75s.length
      ? referenceP75s.reduce((a, b) => a + b, 0) / referenceP75s.length
      : 0;

    if (!calibrationMean) {
      console.error(
        `\n\x1b[41m\x1b[37m PERF CALIBRATION MISSING \x1b[0m\n\n` +
          `  No "${REFERENCE_CALIBRATION_BENCHMARK_NAME}" benchmark ran, so every budget would be\n` +
          `  compared against zero. Failing rather than reporting eight violations that mean\n` +
          `  nothing — each bench suite must include the shared calibration bench.\n`,
      );
      process.exit(1);
    }

    console.log(
      `\x1b[33m[PERF] Calibration: ${(calibrationMean * 1000).toFixed(1)}µs ` +
        `(from ${referenceP75s.length} suite(s)). Budgets are ${HEADROOM}x the recorded ratio.\x1b[0m`,
    );

    // 3. Evaluate every benchmark against its own multiple of that scale
    for (const mod of testModules) {
      this.walkTasks(mod.task.tasks || [], calibrationMean, violations, passes);
    }

    if (violations.length > 0) {
      console.error("\n\x1b[41m\x1b[37m PERF BUDGET EXCEEDED \x1b[0m\n");
      for (const v of violations) {
        console.error(`  ❌ ${v}`);
      }
      /**
       * The calibration reading, printed on failure rather than left for
       * somebody to go looking for.
       *
       * A budget failure has two possible causes and they need telling apart:
       * the code got slower, or the machine did. The scaling factor is the
       * evidence for the second, and printing it here is what turns "the gate is
       * red again" into a question with an answer.
       */
      console.error(
        `  Calibration this run: ${(calibrationMean * 1000).toFixed(1)}µs, from ` +
          `${referenceP75s.length} suite(s). Every budget above is ${HEADROOM}x a recorded ` +
          `multiple of it.`,
      );
      console.error(
        `  A benchmark can exceed its budget two ways: the code got slower, or this machine\n` +
          `  degraded in a way the calibration does not share — heavy swap is the known one, and\n` +
          `  it hits disk-touching benchmarks hardest. Check \`sysctl vm.swapusage\` and background\n` +
          `  load before concluding the code regressed. See REFERENCE_RATIOS in this file.`,
      );
      console.error("");
      process.exit(1);
    } else {
      const checked = Object.keys(REFERENCE_RATIOS);
      if (checked.length > 0) {
        console.log("\n\x1b[42m\x1b[37m PERF BUDGET OK \x1b[0m\n");
        for (const name of passes) {
          console.log(name);
        }
        console.log("");
      }
    }

    // 4. Optionally write baseline (if requested via env)
    if (process.env.WRITE_BASELINE) {
      this.writeBaseline(testModules);
    }
  }

  /**
   * Ratios span three orders of magnitude here — `Fast-Path (Non-UI Logic)` sits
   * at 0.011x and `Extract Long File` at 34x — so a fixed precision prints one
   * of them as `0.0x`, which is not a number anyone can act on.
   */
  private ratio(value: number): string {
    if (value >= 10) return value.toFixed(0);
    if (value >= 1) return value.toFixed(1);
    if (value >= 0.1) return value.toFixed(2);
    return value.toFixed(3);
  }

  private walkTasks(
    tasks: Task[],
    calibrationMean: number,
    violations: string[],
    passes: string[],
  ) {
    for (const task of tasks) {
      if (task.type === "suite" && task.tasks) {
        this.walkTasks(task.tasks, calibrationMean, violations, passes);
      }

      const bench = task.meta?.benchmark && task.result?.benchmark;
      if (!bench) continue;

      const referenceRatio = REFERENCE_RATIOS[task.name];
      if (referenceRatio === undefined) continue;

      const budget = referenceRatio * HEADROOM * calibrationMean;
      const observedRatio = bench.p75 / calibrationMean;

      /**
       * `>` rather than `>=`: a mean that lands exactly on its budget is inside
       * it. The old spelling reported `0.4349ms (budget: 0.4349ms)` as a
       * violation, which is a confusing thing to read and a wrong thing to fail.
       */
      if (bench.p75 > budget) {
        violations.push(
          `${task.name}: ${bench.p75.toFixed(4)}ms p75 — ${this.ratio(observedRatio)}x calibration, ` +
            `budget ${this.ratio(referenceRatio * HEADROOM)}x (${budget.toFixed(4)}ms)`,
        );
      } else {
        passes.push(
          `  ✅ ${task.name}: ${bench.p75.toFixed(4)}ms p75 — ${this.ratio(observedRatio)}x calibration, ` +
            `budget ${this.ratio(referenceRatio * HEADROOM)}x`,
        );
      }
    }
  }

  private writeBaseline(testModules: ReadonlyArray<TestModule>) {
    const baselinePath = "bench-baseline.json";
    let oldBaseline: any = null;

    // 1. Read existing baseline if present
    if (existsSync(baselinePath)) {
      try {
        oldBaseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.warn(`[PERF] Failed to parse existing baseline: ${errorMsg}`);
      }
    }

    // 2. Extract map of old means for comparisons
    const oldMeans = new Map<string, number>();
    if (oldBaseline && oldBaseline.files) {
      for (const file of oldBaseline.files) {
        for (const group of file.groups || []) {
          for (const bench of group.benchmarks || []) {
            if (bench.name && typeof bench.mean === "number") {
              // Precise key combining filepath, group fullName, and benchmark name
              const key = `${file.filepath} > ${group.fullName} > ${bench.name}`;
              oldMeans.set(key, bench.mean);
            }
          }
        }
      }
    }

    // 3. Construct new baseline results
    const results = {
      files: testModules.map((mod) => ({
        filepath: path.relative(process.cwd(), mod.task.file.filepath),
        groups: (mod.task.tasks || [])
          .filter((t: any) => t.type === "suite")
          .map((suite: any) => ({
            fullName: suite.fullName || suite.name,
            benchmarks: (suite.tasks || [])
              .filter((t: any) => t.meta?.benchmark)
              .map((bench: any) => ({
                id: bench.id,
                name: bench.name,
                ...bench.result?.benchmark,
              })),
          })),
      })),
    };

    // 4. Write new baseline
    writeFileSync(baselinePath, JSON.stringify(results, null, 2));
    console.log(
      `\n\x1b[32m[PERF] Baseline written to bench-baseline.json (with relative paths)\x1b[0m\n`,
    );

    // Helper: Dynamic package name resolution by reading packages/*/package.json
    const getPackageNameForFile = (relativeFilepath: string): string => {
      const parts = relativeFilepath.split("/");
      if (parts[0] === "packages" && parts[1]) {
        const pkgDir = parts[1];
        try {
          const packageJsonPath = path.join(process.cwd(), "packages", pkgDir, "package.json");
          if (existsSync(packageJsonPath)) {
            const pkgJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
            if (pkgJson.name) {
              return pkgJson.name;
            }
          }
        } catch {
          // fallback
        }
      }
      return "zintl-monorepo"; // fallback to monorepo root or general tag if outside packages
    };

    // 5. Build global calibration averages to compute a highly stable monorepo-wide machine scaling factor
    let oldCalSum = 0;
    let oldCalCount = 0;
    if (oldBaseline && oldBaseline.files) {
      for (const file of oldBaseline.files) {
        for (const group of file.groups || []) {
          const calBench = (group.benchmarks || []).find(
            (b: any) => b.name === REFERENCE_CALIBRATION_BENCHMARK_NAME,
          );
          if (calBench && typeof calBench.mean === "number" && calBench.mean > 0) {
            oldCalSum += calBench.mean;
            oldCalCount++;
          }
        }
      }
    }
    const oldGlobalCal = oldCalCount > 0 ? oldCalSum / oldCalCount : 0;

    let newCalSum = 0;
    let newCalCount = 0;
    for (const file of results.files) {
      for (const group of file.groups) {
        const calBench = group.benchmarks.find(
          (b: any) => b.name === REFERENCE_CALIBRATION_BENCHMARK_NAME,
        );
        if (calBench && typeof calBench.mean === "number" && calBench.mean > 0) {
          newCalSum += calBench.mean;
          newCalCount++;
        }
      }
    }
    const newGlobalCal = newCalCount > 0 ? newCalSum / newCalCount : 0;

    const scalingFactor = oldGlobalCal > 0 && newGlobalCal > 0 ? newGlobalCal / oldGlobalCal : 1.0;

    // 6. Perform comparison, apply calibration factor, and identify significant deviations
    interface SignificantChange {
      filepath: string;
      groupName: string;
      benchName: string;
      oldMean: number;
      newMean: number;
      normalizedNewMean: number;
      scalingFactor: number;
      pkgName: string;
    }

    const significantChanges: SignificantChange[] = [];
    const affectedPackages = new Set<string>();

    for (const file of results.files) {
      const pkgName = getPackageNameForFile(file.filepath);

      for (const group of file.groups) {
        for (const bench of group.benchmarks) {
          if (bench.mean === undefined || bench.mean === null) continue;

          // Skip the calibration benchmark itself from the changesets table since it is just calibration
          if (bench.name === REFERENCE_CALIBRATION_BENCHMARK_NAME) continue;

          const key = `${file.filepath} > ${group.fullName} > ${bench.name}`;
          const oldMean = oldMeans.get(key) ?? null;

          if (oldMean === null || oldMean <= 0) continue; // Skip new/missing benchmarks from comparison

          // Calibrate the new mean to normalize against the old baseline machine's speed
          const normalizedNewMean = bench.mean / scalingFactor;
          const delta = ((normalizedNewMean - oldMean) / oldMean) * 100;

          // Noise reduction: Only consider >= 5% changes (regressions or enhancements)
          // AND ensure the absolute change is at least 0.05 ms (50 microseconds) to filter out microsecond timing noise
          const absDiff = Math.abs(normalizedNewMean - oldMean);
          if (absDiff >= 0.05 && (delta <= -5 || delta >= 5)) {
            significantChanges.push({
              filepath: file.filepath,
              groupName: group.fullName,
              benchName: bench.name,
              oldMean,
              newMean: bench.mean,
              normalizedNewMean,
              scalingFactor,
              pkgName,
            });
            affectedPackages.add(pkgName);
          }
        }
      }
    }

    // 7. Group significant changes by package
    const changesByPackage = new Map<string, SignificantChange[]>();
    for (const c of significantChanges) {
      if (!changesByPackage.has(c.pkgName)) {
        changesByPackage.set(c.pkgName, []);
      }
      changesByPackage.get(c.pkgName)!.push(c);
    }

    const benchmarkedPackages = new Set<string>();
    for (const file of results.files) {
      benchmarkedPackages.add(getPackageNameForFile(file.filepath));
    }

    const changesetDir = path.join(process.cwd(), PERF_CHANGESET_DIR);
    if (!existsSync(changesetDir)) {
      mkdirSync(changesetDir, { recursive: true });
    }

    const getPackageSlug = (pkg: string): string => {
      return pkg.replace("@", "").replace("/", "-");
    };

    // 8. Generate changesets for affected packages, and clean up stable ones
    for (const pkgName of benchmarkedPackages) {
      const slug = getPackageSlug(pkgName);
      const changesetPath = path.join(changesetDir, `zzz-perf-${slug}.md`);
      const pkgChanges = changesByPackage.get(pkgName) || [];

      if (pkgChanges.length > 0) {
        // Build frontmatter
        let frontmatter = "---\n";
        frontmatter += `"${pkgName}": patch\n`;
        frontmatter += "---\n\n";

        let totalImproved = 0;
        let totalRegressed = 0;
        for (const c of pkgChanges) {
          const delta = ((c.normalizedNewMean - c.oldMean) / c.oldMean) * 100;
          if (delta <= -3) {
            totalImproved++;
          } else if (delta >= 3) {
            totalRegressed++;
          }
        }

        let bodyText = `**⚡ Performance Benchmark Changes Detected**:\n\n`;
        bodyText += `  **Summary:** `;
        if (totalImproved > 0) bodyText += `🟢 ${totalImproved} benchmark(s) improved `;
        if (totalRegressed > 0) bodyText += `🔴 ${totalRegressed} benchmark(s) regressed `;
        bodyText += `(normalized and calibrated against Reference Calibration machine-speed differences).\n\n`;

        bodyText += "  | Benchmark | Baseline | New Run | Calibrated Delta | Status |\n";
        bodyText += "  | :--- | :--- | :--- | :--- | :--- |\n";

        for (const c of pkgChanges) {
          const oldVal = `${(c.oldMean * 1000).toFixed(1)} µs`;
          const rawNewVal = `${(c.newMean * 1000).toFixed(1)} µs`;
          const calNewVal = `${(c.normalizedNewMean * 1000).toFixed(1)} µs`;
          const newValStr = `${rawNewVal} (${calNewVal} calibrated)`;

          const delta = ((c.normalizedNewMean - c.oldMean) / c.oldMean) * 100;
          const deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`;
          const status = delta <= -3 ? "🚀 Faster" : "⚠️ Regressed";

          bodyText += `  | ${c.benchName} | ${oldVal} | ${newValStr} | ${deltaStr} | ${status} |\n`;
        }
        bodyText += "\n";

        writeFileSync(changesetPath, frontmatter + bodyText);
        console.log(
          `\x1b[32m[PERF] Performance changeset written/updated at .changeset/zzz-perf-${slug}.md\x1b[0m\n`,
        );
      } else {
        // Clean up changeset if stable
        if (existsSync(changesetPath)) {
          try {
            unlinkSync(changesetPath);
            console.log(
              `\x1b[33m[PERF] Performance returned to stable for ${pkgName}. Cleaned up obsolete changeset at .changeset/zzz-perf-${slug}.md\x1b[0m\n`,
            );
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.warn(`[PERF] Failed to delete stable changeset: ${errorMsg}\n`);
          }
        }
      }
    }
  }
}
