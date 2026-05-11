/**
 * Zintl Performance Budget Reporter
 *
 * A custom Vitest benchmark reporter that enforces absolute latency thresholds.
 * When a benchmark's mean latency exceeds its budget, this reporter sets
 * `process.exitCode = 1` to fail the CI pipeline.
 *
 * Usage: Configured in vite.config.ts under test.benchmark.reporters
 */

// Performance budgets (mean latency in milliseconds on a baseline machine)
const BUDGETS: Record<string, number> = {
  // --- Compiler Pipeline ---
  "Hot HMR Latency (Warm Path)": 0.01,
  "Structural HMR Latency (Patch Path)": 0.4,
  "Catalog Serialization Logic": 0.4,
  "Colony HMR Latency (Manager Sync)": 0.65,

  // --- Extractor & Fast-Path ---
  "Extract Short File": 0.05,
  "Extract Long File (200 keys)": 2.5,
  "Fast-Path (No Translations/Sinks)": 0.05,
  "Fast-Path (Non-UI Logic)": 0.002,
};

/**
 * Reference mean latency for the calibration benchmark on the "Golden Baseline" machine.
 * This should match the machine used to define the original budgets.
 */
const GOLDEN_REFERENCE = 0.0005; // 0.6ms (600μs) for calibration bench on baseline machine

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
    let referenceMeans: number[] = [];
    const findCalibration = (tasks: Task[]) => {
      for (const t of tasks) {
        if (t.name === "Reference Calibration (No-Op)" && t.result?.benchmark) {
          referenceMeans.push(t.result.benchmark.mean);
        }
        if (t.tasks) findCalibration(t.tasks);
      }
    };

    for (const mod of testModules) {
      if (mod.task.tasks) findCalibration(mod.task.tasks);
    }

    // 2. Determine scaling factor (1.0 = baseline machine)
    const avgReferenceMean = referenceMeans.reduce((a, b) => a + b, 0) / referenceMeans.length;
    const factor = avgReferenceMean ? avgReferenceMean / GOLDEN_REFERENCE : 1.0;
    // const finalFactor = factor > 1.0 ? factor : 1.0;

    if (factor > 1) {
      console.log(
        `\x1b[33m[PERF] Detected slow hardware (Factor: ${factor.toFixed(2)}x). Adjusting budgets...\x1b[0m`,
      );
    } else if (factor < 1) {
      console.log(
        `\x1b[33m[PERF] Detected fast hardware (Factor: ${factor.toFixed(2)}x). Budgets will be adjusted downward.\x1b[0m`,
      );
    }

    // 3. Evaluate all benchmarks with adjusted budgets
    for (const mod of testModules) {
      this.walkTasks(mod.task.tasks || [], factor, violations, passes);
    }

    if (violations.length > 0) {
      console.error("\n\x1b[41m\x1b[37m PERF BUDGET EXCEEDED \x1b[0m\n");
      for (const v of violations) {
        console.error(`  ❌ ${v}`);
      }
      console.error("");
      process.exit(1);
    } else {
      const checked = Object.keys(BUDGETS);
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

  private walkTasks(tasks: Task[], factor: number, violations: string[], passes: string[]) {
    for (const task of tasks) {
      if (task.type === "suite" && task.tasks) {
        this.walkTasks(task.tasks, factor, violations, passes);
      }

      const bench = task.meta?.benchmark && task.result?.benchmark;
      if (!bench) continue;

      const baseBudget = BUDGETS[task.name];
      if (baseBudget === undefined) continue;

      // Apply hardware scaling factor to the budget
      const adjustedBudget = baseBudget * factor;

      if (bench.mean >= adjustedBudget) {
        violations.push(
          `${task.name}: ${bench.mean.toFixed(4)}ms (budget: ${adjustedBudget.toFixed(4)}ms [${factor.toFixed(2)}x scaled])`,
        );
      } else {
        passes.push(
          `  ✅ ${task.name}: ${bench.mean.toFixed(4)}ms (budget: ${adjustedBudget.toFixed(4)}ms)`,
        );
      }
    }
  }

  private writeBaseline(testModules: ReadonlyArray<TestModule>) {
    const fs = require("node:fs");
    const path = require("node:path");

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

    fs.writeFileSync("bench-baseline.json", JSON.stringify(results, null, 2));
    console.log(
      `\n\x1b[32m[PERF] Baseline written to bench-baseline.json (with relative paths)\x1b[0m\n`,
    );
  }
}
