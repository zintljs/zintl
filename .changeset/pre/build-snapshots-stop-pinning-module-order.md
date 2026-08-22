---
"@zintljs/testing": patch
---

Build snapshots no longer pin the order Rspack happens to write modules in.

`[Production Build] rsbuild-vanilla-basic` passed on every developer machine and failed on CI, with a
diff that looks alarming and means nothing: module `8` — the raw asset text, which imports nothing —
appearing before module `12` locally and after it on CI. Same ids, byte-identical bodies, different
sequence. A chunk is emitted as `push([[3], { 7(…){…}, 8(…){…}, 12(…){…} }])`, and which module lands
where depends on the order the build _finished_ them, which is timing and therefore machine.

`filterDistForSnapshots` now sorts module blocks by id, so the snapshot asserts what the bundle
contains rather than what order the bundler wrote it in. Sorted rather than stripped: a module
appearing or disappearing still fails, which is the part that matters. Files without that shape pass
through untouched, and an unterminated block leaves the file exactly as it was rather than emitting a
half-reordered approximation.

Regenerating the 24 affected snapshots produced 100,052 insertions against 100,052 deletions, and the
sorted line multiset is identical before and after — confirmed per file, so the update is provably a
permutation and not a content change.

Separately, `describeStall` no longer attaches browser diagnostics to failures in project mode.
`build`, `graph` and the transform contracts run without a page, and this one reported
`hmr packets: unavailable`, `settle beacon: unreadable` and — on a production bundle snapshot
mismatch — `← the page itself is the failure`, pointing an investigation at a browser that was never
opened. The compiler ledger and HMR trace are genuinely useful there and are kept; the browser-side
sections are skipped rather than answered wrongly, under a `── build diagnosis (no page) ──` header.
