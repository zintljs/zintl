---
"@zintljs/compiler": patch
---

Fix a race in `flush()` that could silently drop the latest edit to a boundary under rapid, overlapping hot updates.

`runFlush` snapshotted the dirty boundary set into `adopted` before writing catalogs, then unconditionally cleared every adopted id from `dirtyBoundaries` afterward. If a newer edit re-dirtied that exact boundary after its catalog had already been written but before that cleanup ran, the cleanup deleted the fresh dirty flag anyway — the newer content was never flushed, and nothing was left to schedule it for later. Locally each edit's cycle finishes before the next one starts, so the window never opened; under CI's slower scheduling, overlapping flushes were common enough to hit it, which is why `hmr-hammer` only flaked in CI.

`MessageManager` now tracks a `dirtyRevisions` counter per boundary, bumped by a new `markDirty()` on every dirty mark. `runFlush` snapshots each adopted boundary's revision at adoption time and only clears it if the revision is unchanged — i.e. nothing re-dirtied it while this run was writing.
