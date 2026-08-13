import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Flake instrument — run a contract N times and report how often it fails.
 *
 * This exists because of what happened without it. Judging a change on three
 * runs produced four reverts in one session, two of them against a baseline
 * that drifted from 1-in-3 to 6-in-6 with no code change between the batches.
 * A single run of an intermittent contract carries almost no information, and a
 * comparison against a baseline measured an hour earlier carries less than that.
 *
 * So the rule this tool enforces by being convenient:
 *
 *  1. **N ≥ 10**, and
 *  2. the baseline is measured in the **same batch** as the change, and
 *  3. the build is confirmed *before* any run, because a failed build leaves a
 *     stale `dist` and every test then reports on code you did not write.
 *
 * Usage:
 *   node scripts/flake.js syntax-recovery              # 10 warm runs
 *   node scripts/flake.js hmr.contract --runs=20
 *   node scripts/flake.js all --runs=5                 # the whole contract suite
 *   node scripts/flake.js hmr-hammer --mode=cold       # wipe .tmp/runs before each run
 *   node scripts/flake.js hmr-hammer --mode=both       # both, reported separately
 *   node scripts/flake.js syntax-recovery --no-build   # you just built; skip it
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith("--"));
const runsArg = args.find((a) => a.startsWith("--runs="));
const modeArg = args.find((a) => a.startsWith("--mode="));
const skipBuild = args.includes("--no-build");

const RUNS = runsArg ? Number(runsArg.slice("--runs=".length)) : 10;
const MODE = modeArg ? modeArg.slice("--mode=".length) : "warm";

if (!filter) {
  console.error(
    "usage: node scripts/flake.js <contract-filter|all> [--runs=N] [--mode=warm|cold|both]",
  );
  process.exit(2);
}
if (!["warm", "cold", "both"].includes(MODE)) {
  console.error(`unknown --mode=${MODE}; expected warm, cold or both`);
  process.exit(2);
}

const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const dim = (s) => `\x1b[2m${s}\x1b[22m`;
const green = (s) => `\x1b[32m${s}\x1b[39m`;
const red = (s) => `\x1b[31m${s}\x1b[39m`;

const log = (m = "") => process.stdout.write(`${m}\n`);

function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", shell: false });
}

/**
 * Build once, and refuse to measure if it failed.
 *
 * Rule 3, and it is here rather than in a comment because it has already cost
 * this project two rounds of meaningless green results: a source file left
 * unparseable, `vpr build` failing, and the suite then happily reporting PASS
 * against the previous `dist`.
 */
function ensureBuilt() {
  if (skipBuild) {
    log(dim("skipping build (--no-build); results describe whatever is in dist/"));
    return;
  }
  log(dim("building…"));
  const built = run("vpr", ["build"]);
  if (built.status !== 0) {
    log(red("BUILD FAILED — refusing to measure against a stale dist."));
    log(built.stdout?.split("\n").slice(-25).join("\n") ?? "");
    log(built.stderr?.split("\n").slice(-25).join("\n") ?? "");
    process.exit(1);
  }
}

/** Every `× [Contract] project` line vitest printed. */
function failuresIn(output) {
  const found = [];
  for (const line of output.split("\n")) {
    const m = line.match(/×\s+(\[[^\]]+\]\s+[\w-]+)/);
    if (m) found.push(m[1].replace(/\s+/g, " ").trim());
  }
  return found;
}

function once(mode) {
  if (mode === "cold") fs.rmSync(path.join(ROOT, ".tmp/runs"), { recursive: true, force: true });
  const result =
    filter === "all"
      ? run("vpr", ["test:contracts"])
      : run("vp", ["test", "--config=tests/vitest.config.ts", filter]);
  const output = `${result.stdout}${result.stderr}`;
  return { failures: failuresIn(output), status: result.status ?? 1, output };
}

function batch(mode) {
  log("");
  log(bold(`── ${filter} · ${RUNS} runs · ${mode} ──────────────────────`));

  const tally = new Map();
  let runsWithFailures = 0;
  const started = Date.now();

  for (let i = 1; i <= RUNS; i++) {
    const { failures, status } = once(mode);
    if (failures.length > 0 || status !== 0) runsWithFailures += 1;
    for (const f of failures) tally.set(f, (tally.get(f) ?? 0) + 1);

    const label = String(i).padStart(2);
    log(
      failures.length === 0
        ? `  run ${label}  ${green("clean")}${status === 0 ? "" : dim("  (non-zero exit, no × lines — read the log)")}`
        : `  run ${label}  ${red(`${failures.length} failed`)}  ${dim(failures.join(", "))}`,
    );
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  log("");
  log(
    `  ${bold(`${runsWithFailures}/${RUNS}`)} runs had a failure   ${dim(`${seconds}s total, ${Math.round(seconds / RUNS)}s per run`)}`,
  );
  if (tally.size > 0) {
    log("");
    log("  by case:");
    for (const [name, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
      log(`    ${String(count).padStart(3)}/${RUNS}  ${name}`);
    }
  }
  return runsWithFailures;
}

ensureBuilt();

const modes = MODE === "both" ? ["warm", "cold"] : [MODE];
let worst = 0;
for (const mode of modes) worst = Math.max(worst, batch(mode));

log("");
log(
  worst === 0
    ? green(`clean across ${RUNS} run(s) — a real baseline, not a lucky one`)
    : `record this number next to the change you are about to make, and re-measure in the same batch`,
);
