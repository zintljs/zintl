---
"@zintljs/compiler": patch
---

Report catalog-delivery failures instead of swallowing them.

`loadLazyBoundary` discarded every failure mode it had: a rejected promise (`.catch(() => …)`), an empty result (`if (!res) return;`), and a synchronous throw (`catch {}`). All three cleared `pendingBoundaries` and scheduled no retry — so once delivery failed, `_t` returned `""` for every key in that boundary permanently, and nothing anywhere recorded why.

An empty string is not a missing fallback; it is a read that returned the wrong value. The compiler's integrity check guarantees catalogs are complete, so a miss at runtime means _delivery_ failed, not content — and blank UI with no trace is the worst possible way to express that.

All three sites now report in development, naming the boundary, the locale, and the consequence. Behaviour is otherwise unchanged: no fallback, no retry, no recovery invented. This makes a silent wrong-value read a loud one.

Worth noting why this was never seen: the only diagnostic in the whole path was a `console.warn` gated on the old `typeof process !== "undefined"` guard, which never evaluated true in a browser. Client-side, this failure mode has been invisible for the project's entire life.

Production output is unaffected — the logging is behind `__ZINTL_DEV__` and is eliminated at build time (verified: no such strings appear in any `dist` snapshot).
