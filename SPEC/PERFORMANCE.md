# Zintl Performance Constitution

Zintl is architected for "Light Speed" internationalization. To ensure we never degrade the developer experience, we enforce strict performance budgets in our CI pipeline.

## Performance Budgets

| Operation          | Path                | Budget    | target   |
| :----------------- | :------------------ | :-------- | :------- |
| **Hot HMR**        | `transform` (warm)  | **0.5ms** | < 0.05ms |
| **Structural HMR** | `transform` (patch) | **1.5ms** | < 0.20ms |
| **Serialization**  | `flush`             | **5.0ms** | < 1.00ms |

## Gating System

We use a custom Vitest reporter defined in [budget-reporter.ts](file:scripts/budget-reporter.ts).

### How it works

1. **Reporting**: Standard Vitest output shows Hz, percentiles, and deltas.
2. **Enforcement**: If the **mean** latency of any benchmark exceeds its budget, the reporter calls `process.exit(1)` to fail the CI.

## Commands

### `npm run bench`

Runs the full suite and updates the "Golden Baseline" in `bench-baseline.json`.

> [!IMPORTANT]
> Use this command locally before committing if you have intentionally changed the architecture.

### `npm run bench:check`

Runs the suite in "Audit Mode." This command should be used in CI to verify that the current code meets all budgets.

## Optimization Strategy

To maintain these speeds, Zintl utilizes:

1. **Stable Hashing**: Files are only re-processed if their semantic content changes.
2. **Boundary Memoization**: Transform results are cached at the module level.
3. **AST Short-Circuiting**: The extractor skips logic if no `zintl` or template literal patterns are detected.

---

_Claritas! The paths are readable, the bloat is dead._
