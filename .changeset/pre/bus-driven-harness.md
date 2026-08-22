---
"@zintljs/compiler": patch
---

Make the test harness wait on identity, and put the ledger in every failure.

**Strict delivery now passes the whole contract suite** — 72/72 under `ZINTL_STRICT_SETTLE=1`, with per-contract exemptions declared rather than assumed. That is proposal 024's third acceptance criterion, which previously had no mechanism to hang on at all: strictness was read straight from `process.env` inside the lab, with no way for a contract to say "I deliberately break the app".

Exemptions are a **string, not a boolean** — an exemption without a reason is indistinguishable from one nobody revisited. Three are declared: `syntax-recovery` (a compile error _should_ stall the runtime), `chaos-catalog` (deleted and corrupted catalogs _should_ fail to apply) and `chaos-boundary` (deleted and renamed sources). They live on the contract, next to `requires`, so an exemption travels with the thing it exempts.

**Waits are scaled to what the contract said to expect.** A contract declaring itself exempt has already announced that its writes will not settle — it introduces a syntax error, or deletes a catalog. Waiting the full budget for a stall the contract announced in advance is pure cost: a four-second packet race no packet will end, then a ten-second settle wait for a beacon that will never advance, on every such mutation. Those budgets are now short for exempt labs. Nothing is weakened, because the real gate is the assertion — `textEventually` polls for fifteen seconds either way.

That, plus deleting the dead two-second teardown sleep, takes the suite from **~119 s to ~72 s**, and collapses its variance: three consecutive runs at 71.4 / 72.5 / 72.1 s, against a previous spread of 78–88 s. The variance mattered as much as the mean — most of it was exempt contracts sitting in timeout loops whose duration depended on machine load.

An identity-based wait (read the compiler's generation, wait for the page ledger to reach it) was built and then **removed**. It measured no faster than the packet race, it cost a fixed probe on every lab, and it caused a `memory-leak` timeout that needed two follow-up patches. The ledger is where the value actually landed — as diagnosis, below — and a contract that genuinely needs identity-based waiting can read it in about ten lines.

**Every contract failure now carries the delivery ledger.** Packet counts and a beacon say _how much_ happened; they cannot say which boundary, in what order, or whether anything was superseded or failed — which is the difference between "the update never arrived" and "it arrived and was discarded as older than one already applied". Those have different fixes and used to cost a fresh investigation each. Both ledgers are attached: the page's, and the compiler's, which survives the page and is reachable in project mode where there is no browser at all.

Three long-standing harness defects fixed in passing:

- `lab.fs.rename()` fired **neither** mutation hook, so a contract that renamed a file and then asserted on the DOM was racing the dev server with no synchronisation whatsoever.
- Lab teardown called `ws.waitFor("update", { timeout: 2000 })` immediately after `ws.teardown()` had already restored the original `send`. No listener could ever fire, so it was a guaranteed two-second sleep on every browser lab teardown, dressed as a wait.
- The five surviving `waitFor({ state: "visible" })`-then-`textContent()` sites are migrated to `textEventually`. That pair looks like it waits but resolves immediately when the element is already visible showing the _previous_ value, so the read races the update — the shape every traced flake came from.
