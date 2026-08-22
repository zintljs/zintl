---
"@zintljs/testing": patch
---

Stop `chaos-boundary` asserting a behaviour that only exists inside the test runner.

The contract ended by checking that a renamed boundary's old catalogs were pruned from disk. Two
projects failed it for seven passes and were carried as permanent skips. Measured, they fail _only_
that assertion — the rename works, the translations survive it, hot updates reach the new path, and
the compiler forgets the deleted boundary.

`pruneOrphanedBoundaries` returns early when `isDev && !isTestEnv`, so pruning is disabled in real
development sessions by design; `isTestEnvironment()` is true here only because the harness runs its
dev server inside vitest. In a real `pnpm dev` session every project leaves those catalogs behind, so
the assertion described no user-visible difference between the projects that passed and the ones that
did not.

It is removed. `chaos-boundary` now asserts what a rename must do for a person using Zintl, and is
claimed by all four Vite projects rather than two. `noOrphanedCatalogs` stays in the harness,
documented and uncalled: pruning is live in builds, where nothing asserts it yet, and a post-build
orphan check is where the question belongs.

Also: `chaos-catalog` no longer re-proves that locale switching works before breaking anything —
`locale-switch` owns that — which was pushing the suite's longest contract past its cap. Two
Vue-on-Rspack projects still cannot fit it and do not claim `chaos`.
