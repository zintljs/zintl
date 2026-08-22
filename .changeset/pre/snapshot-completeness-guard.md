---
"@zintljs/testing": patch
---

Fail when a snapshot exists for output that is no longer produced.

`snapshotAll` iterates the files a build emitted _this_ run, so it can only check output that still exists. Stop emitting one — a chunk that disappears, a catalog no longer written — and its snapshot is simply never read. The suite stays green while output silently vanished, which is the one regression a snapshot test should be structurally incapable of missing.

The prefix directory is now compared against the produced set, so the snapshot tree asserts the _shape_ of the output rather than the content of whatever survived. Each `snapshotAll` call owns its prefix exclusively (`<project>/dist-output`, `/dev-transforms`, `/prod-transforms`), so every file under it is expected to correspond to something produced.

- Outside update mode an orphan fails with the list and a pointer to `-u`.
- Under `-u` orphans are pruned, matching how vitest handles obsolete inline snapshots — the author is deliberately re-baselining.
- If vitest ever stops exposing `testPath`, the guard **throws rather than skipping**. Silently skipping is precisely the failure it exists to prevent.

Verified both directions: a planted ghost snapshot is caught (`Output disappeared: assets/__ghost_chunk.js`), `-u` prunes it, and no real snapshot is touched.
