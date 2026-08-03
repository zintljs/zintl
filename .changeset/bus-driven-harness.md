---
"@zintljs/compiler": patch
---

Make the test harness wait on identity, and put the ledger in every failure.

**Strict delivery now passes the whole contract suite** — 72/72 under `ZINTL_STRICT_SETTLE=1`, with per-contract exemptions declared rather than assumed. That is proposal 024's third acceptance criterion, which previously had no mechanism to hang on at all: strictness was read straight from `process.env` inside the lab, with no way for a contract to say "I deliberately break the app".

Exemptions are a **string, not a boolean** — an exemption without a reason is indistinguishable from one nobody revisited. Three are declared: `syntax-recovery` (a compile error _should_ stall the runtime), `chaos-catalog` (deleted and corrupted catalogs _should_ fail to apply) and `chaos-boundary` (deleted and renamed sources). They live on the contract, next to `requires`, so an exemption travels with the thing it exempts.

**Waiting is causal rather than volumetric.** After a mutation the harness reads the generation the compiler stamped and waits until the page's delivery ledger shows a catalog at least that new. The old wait raced the first `update` or `full-reload` off the wire, which carries no identity — it resolves on whatever arrives first, including an update caused by another worker's contract.

Two things that only showed up in the doing, both now in ZDB §9:

- **A causal wait must report _why_ it finished.** Three outcomes, not two: delivered, unavailable, timed out. Collapsing the last two costs in both directions — a wait that reports success when it did nothing is exactly the failure mode that made the old heuristic untrustworthy, and a caller that falls back after already spending its budget spends it twice per mutation.
- **Some apps have no sequence to wait on.** Where catalogs arrive through the manager's loader rather than a generation-stamped content module, the wait can never be satisfied. Probing once per lab and remembering the answer is the difference between `memory-leak` (twenty sequential edits) passing and timing out at 45 s; paying the timeout per mutation is not.

**Every contract failure now carries the delivery ledger.** Packet counts and a beacon say _how much_ happened; they cannot say which boundary, in what order, or whether anything was superseded or failed — which is the difference between "the update never arrived" and "it arrived and was discarded as older than one already applied". Those have different fixes and used to cost a fresh investigation each. Both ledgers are attached: the page's, and the compiler's, which survives the page and is reachable in project mode where there is no browser at all.

Three long-standing harness defects fixed in passing:

- `lab.fs.rename()` fired **neither** mutation hook, so a contract that renamed a file and then asserted on the DOM was racing the dev server with no synchronisation whatsoever.
- Lab teardown called `ws.waitFor("update", { timeout: 2000 })` immediately after `ws.teardown()` had already restored the original `send`. No listener could ever fire, so it was a guaranteed two-second sleep on every browser lab teardown, dressed as a wait.
- The five surviving `waitFor({ state: "visible" })`-then-`textContent()` sites are migrated to `textEventually`. That pair looks like it waits but resolves immediately when the element is already visible showing the _previous_ value, so the read races the update — the shape every traced flake came from.
