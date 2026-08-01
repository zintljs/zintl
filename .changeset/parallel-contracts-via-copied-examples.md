---
"@zintljs/testing": minor
---

Add `copiedExampleSource`, unlocking parallel contract runs.

`maxWorkers: 1` was not caution — it was load-bearing. Contracts mutate their project (`lab.fs.edit(adapter.headingFile)`), and several contracts target the _same_ file of the same example: `hmr`, `hmr-hammer`, `memory-leak`, and `performance-hmr` all edit `examples/react-basic/src/App.tsx`. Running four workers against the shared `examples/` tree produced **31 failures out of 72, no speedup, and a corrupted working tree**.

`copiedExampleSource(dir)` gives each worker a private copy under `.tmp/runs/w<id>/`, removing the shared mutable state entirely.

- **Per-worker, not per-test.** Dev servers are pooled by example name in module scope, so every lab for an example inside one worker must resolve to the same root; a per-test copy would leave the pooled server rooted at a directory the next test no longer uses.
- **`node_modules` is a shallow symlink farm**, not a copy or a directory link. Linking the directory itself would send Vite's `node_modules/.vite` cache writes back into the real example, reintroducing cross-worker contention through the back door.
- **Snapshot paths are normalized** back to `examples/<name>`, so output is byte-identical whichever source materialized it. Verified: zero snapshot churn after the switch.

Measured on the same machine:

|                       | Serial, shared   | 4 workers, copied |
| --------------------- | ---------------- | ----------------- |
| Duration              | 338s             | **140-155s**      |
| Failures              | 0 (with retries) | 0                 |
| Retries used          | 3                | **0**             |
| `examples/` after run | mutated          | pristine          |

Parallelism turned out to _reduce_ flakiness rather than add it — isolated projects remove cross-test interference that the shared tree was quietly causing.

The HMR wall-clock budget now relaxes under `ZINTL_PARALLEL` as it already did under `CI`: with sibling workers competing for the machine, the number measures the hardware, not Zintl. `vpr bench` remains the real performance instrument.
