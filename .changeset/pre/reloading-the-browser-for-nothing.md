---
"@zintljs/compiler": patch
"zintljs": patch
"@zintljs/testing": patch
---

Stopped Zintl reloading the browser over files nobody changed, which is what `syntax-recovery` was intermittently stalling on. Measured back to back on `vanilla-spa-basic`: **2/20 before, 0/20 after**.

**A watcher report is not an edit.** `computeHotUpdatePlan` decided whether an event was Zintl's own by asking `isWritingFile` — a 500 ms window, and ZDB Corollary D1a says a window is never a guard. Used as one it failed in both directions. Instrumenting a single _passing_ run caught ten echoes of Zintl's own writes arriving with the guard already shut, at 118–209 ms against a nominal 500, because the timer is armed per write and an early write's timer closes the guard on a later one. And authorship was the smaller half: the event that actually stalls the contract is a report for a catalog **nobody wrote** — a worker copy settling, an initial scan draining — arriving seconds into the test.

Either way the compiler marks the boundary dirty, and `index.html.<locale>.json` maps back to the `index.html` boundary, which the plan answers with a full page reload. Land that while the app does not compile and the page cannot come back: the entry fails to load, so there is no runtime and no module registered for it, and the recovery edit arrives as a hot `update` with nothing left in the page able to accept it. `vanilla-spa-basic` alone, because it is the only project whose edited file _is_ the client entry.

So the question asked is now content, not authorship and not a clock: `IOManager` keeps a signature of what it believes is at a path — set by the first read, moved only by a write, and dropped once an event has been taken as genuine, so a real edit is never mistaken for a repeat. Each write also closes its own guard window rather than whichever one is open.

**A repoint that only strips an extension is not a repair.** `getNormalizedId` strips `.ts`/`.js` from a boundary id, so the boundary for `src/main.ts` is `src/main` and `ViteUpdateApplier` repointed the module's `file` onto `<root>/src/main` — a path no file has. Vite could then no longer reach it from the file that changed, and the next edit arrived with `modules: []`, so Vite never dropped its own transform cache. This is ledger L-023's unexamined hypothesis, now measured and closed.

**The diagnosis says who reloaded the page.** A `full-reload` in the ledger may be Zintl's or Vite's own, and those call for opposite fixes; Zintl's now records a `reload` trace entry. The stall report also carries the network requests it failed or never answered, and the whole console rather than its last four lines — the two things that turned this diagnosis from inference into reading.
