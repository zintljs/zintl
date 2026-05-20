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

const GOLDEN_REFERENCE = 0.0165; // ~16.5μs for pure JS math calibration loop on baseline machine

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

    const baselinePath = "bench-baseline.json";
    let oldBaseline: any = null;

    // 1. Read existing baseline if present
    if (fs.existsSync(baselinePath)) {
      try {
        oldBaseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
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
    fs.writeFileSync(baselinePath, JSON.stringify(results, null, 2));
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
          if (fs.existsSync(packageJsonPath)) {
            const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
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
            (b: any) => b.name === "Reference Calibration (No-Op)",
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
          (b: any) => b.name === "Reference Calibration (No-Op)",
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
          if (bench.name === "Reference Calibration (No-Op)") continue;

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

    const changesetDir = path.join(process.cwd(), ".changeset");
    if (!fs.existsSync(changesetDir)) {
      fs.mkdirSync(changesetDir, { recursive: true });
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

        fs.writeFileSync(changesetPath, frontmatter + bodyText);
        console.log(
          `\x1b[32m[PERF] Performance changeset written/updated at .changeset/zzz-perf-${slug}.md\x1b[0m\n`,
        );
      } else {
        // Clean up changeset if stable
        if (fs.existsSync(changesetPath)) {
          try {
            fs.unlinkSync(changesetPath);
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
