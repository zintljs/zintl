---
"zintljs": patch
"@zintljs/testing": patch
---

Added a silent, always-on diagnostic trace for `handleHotUpdateHook` (`Context.hmrTrace`), pursuing ledger L-023 / proposal 027 §2.4's HMR ordering defect. Records every hook invocation, both early-return guards, every `mod.file` reassignment the fallback scan performs, and the return outcome — a ring buffer, never a `console.*` call, so it cannot perturb the timing it's observing.

The first attempt at this used `DEBUG`-gated `vLogger.debug` calls, and testing surfaced a real, separate finding: enabling the exact `DEBUG=zintl:vite` scope needed to see them suppresses `handleHotUpdateHook`'s invocation entirely (measured: 32-40 invocations per run with `DEBUG` unset, 0 across repeated runs with that scope enabled). Recorded in the ledger rather than chased further; the ring buffer routes around it by never printing.

Surfaced through the test harness via `LabCompiler.hmrTrace` (reusing the existing `globalThis.__zintl_active_contexts` bridge `LabCompiler.instance` already relied on) and automatically included in `describeStall()`'s failure diagnosis, alongside the existing wire-, runtime-, and compiler-ledger sections.

A ten-run full-suite reproduction pass caught zero `hmr-hammer` failures and zero evidence for the `mod.file`-repointing hypothesis this instrumentation was built to test — inconclusive at this sample size, and the instrumentation is left in place for a future, larger attempt. The pass did catch an adjacent failure (`memory-leak` on `react-basic`) pointing at a different, already-named, still-open item: proposal 024's `entryReexecutionSafe`/React `createRoot` gap. Full writeup in `docs/spec/proposals/027-leak-ledger.md`, L-023.
