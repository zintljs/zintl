---
"zintljs": patch
"@zintljs/testing": patch
---

Record which bundler environment reported each hot update, and widen the trace a failure prints.

Vite 6+ defines `client` and `ssr` environments and calls the hot-update hook once per environment, so
a client-only file produces a perfectly correct `modules=0` passthrough on the `ssr` pass. The trace
recorded neither environment, so that line was indistinguishable from an update that reached nothing —
and it was the most prominent line in a failing diagnosis that two investigations read as the defect.

With the environment recorded, the same failure reads unambiguously: the `client` environment handled
every update, invalidating five modules each time, and only `ssr` passed through. The failure is in
update application in the browser, not in anything the compiler decided.

The failure diagnosis now prints the last 40 trace entries rather than the last 10, because at 10 the
answer was past the end of the window. Both are emitted only when a contract fails.
