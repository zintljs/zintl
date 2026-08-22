---
"@zintljs/compiler": patch
"@zintljs/testing": patch
"zintljs": patch
---

Reclaim every boundary a deleted file owned, and give the harness a filesystem trace.

`removeFile` reclaimed only the boundaries `boundaryOwnership` listed for a file. A file that is an
entry, or that carries an HTML projection, also registers a boundary under the bare file id — which
that map does not list — so deleting the file left a graph node behind for the life of the process.
Matching graph nodes by id as well closes it. Content-addressed ids are unaffected: they are not
derived from a path, so the ownership map remains the only route to them.

**Two diagnoses in the ledger are retracted by this pass**, and the correction is worth more than the
fix. Both rested on reading the debug logger's `+Nms` — a delta since the _previous log line_ — as
the time since a named event. Interleaved against the harness's own filesystem operations, the
"residual writer re-registering a forgotten boundary" turns out to be **teardown**: `restoreAll` puts
the file back and a boundary is registered for a file that exists, which is correct. A removal-epoch
probe confirmed it independently — every such read began after the deletion, not during it.

New in the testing package: `ZINTL_FS_TRACE` timestamps what the harness itself does to a project's
files, so the compiler's log and the test's mutations can be read in one order; `boundaryForgotten`
now reports _which_ graph node it matched instead of only that one existed; and the Rspack watch
trace records removed files, not just modified ones, so "the host reported nothing" and "we dropped
it" stop looking identical.
