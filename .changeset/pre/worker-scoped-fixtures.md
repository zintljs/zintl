---
"@zintljs/testing": patch
---

Fixed inline contract fixtures racing each other across test workers.

`copiedExampleSource` and `dirSource` materialize into `.tmp/runs/w<worker>/`, memoize per worker, and make `cleanup()` a deliberate no-op because pooled dev servers outlive the labs that created them. `fixtureSource` did none of that: every worker materialized the same `.tmp/fixtures/<id>`, wiped it on entry, and deleted it on teardown.

That is a race with two ways to lose. One worker wipes the tree while another is mid-run against it, and one worker's cleanup deletes the tree whose pooled dev server another worker is still serving from. It is now worker-scoped, wiped once per worker rather than once per lab, with a no-op cleanup — the same model as the other two sources.

This was the cause behind part of a long-standing symptom: at the committed `maxWorkers: 4` the contract suite failed roughly one test per run, a different one each time. Both fixture-backed manifests (`assets-basic`, `ssr-streaming`) were among the victims and stopped appearing after this change — measured across full runs, 2 failures in 3 before versus 1 in 8 after.

The residual failure is a separate defect and is not addressed here: `hmr-hammer` occasionally sees four hot-update events for five writes, with every delivered update applied successfully. Diagnosis is recorded in `docs/spec/proposals/026-leak-ledger.md`.
