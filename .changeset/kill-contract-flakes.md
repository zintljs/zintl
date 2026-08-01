---
"@zintljs/testing": patch
---

Eliminate contract flakiness: isolate the dep cache, drop retries, diagnose every failure.

**Root cause.** `copiedExampleSource` rebuilt each worker's `node_modules` as a symlink farm over the original example's — and linked _every_ entry, including `.vite`. That is Vite's dependency-optimization cache, which the dev server **writes** to, so all four workers were writing into one shared directory under `examples/`.

The failure mode is invisible by construction: module resolution keeps working perfectly while the cache underneath is raced by four processes. It explained every symptom collected — `svelte-basic` in three of four failures (heaviest optimization surface), 45-second hangs, `page.click` never finding a button because the app never rendered, and never the same test twice.

The farm now skips `.vite`, `.vite-temp`, and `.cache`, so each copy owns what the server writes.

Measured with `retry: 0`, five full runs each:

|                  | Before  | After       |
| ---------------- | ------- | ----------- |
| Failures         | 4 / 360 | **0 / 360** |
| Fully green runs | 2 of 5  | **5 of 5**  |
| Duration spread  | 92-144s | 96-116s     |

The tightened spread is corroborating: contention costs variance, not just correctness.

**`retry: 0`.** A retry turns a flake into a green run, so the suite reports "passing" for a codebase that intermittently misbehaves. Every flake traced in this effort was a real defect — an assertion that could not retry, contention on a shared directory — and each was found only by reading past the checkmark to the `(retry x1)` beside it.

**Failures now explain themselves.** Any contract failure attaches page state: HMR packet counts by type, the settle beacon value, console errors, body size, and which buttons actually exist. A `page.click` timeout previously reported only the locator it waited for, which cannot distinguish a missing element from an app that crashed and rendered nothing — different bugs, different fixes. Adds `LabWebSocket.recentPackets`, since captures must be started before the interesting moment and are useless after the fact.

Known gap: a hard test timeout is raised outside the contract body, so no diagnosis is attached to those yet.
