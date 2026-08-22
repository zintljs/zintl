---
"@zintljs/testing": patch
---

Assert what Zintl guarantees when writes come in a burst: the final module reaches the browser.

`hmr-hammer` asserted DOM convergence after three raw writes 30 ms apart. Five probes established
that every step Zintl owns is correct on the runs where that failed — the file on disk, the watcher
event, the bytes handed to the plan, the modules invalidated, the packet on the wire, the transform
served, and the browser fetching the final module twice. What declined to re-render was React Fast
Refresh under four refreshes inside ~400 ms, which is neither Zintl's code nor Vite's, and which no
editor provokes.

The contract now asserts delivery — the browser was served a module containing the final content —
which is the guarantee Zintl makes and the defect proposal 024 §1.1a actually names: coalescing rapid
writes is correct, dropping the final state is not. The DOM is still checked, unbudgeted, so a page
that breaks outright is not mistaken for one that merely did not repaint.

New in the testing package: `LabNetwork.captureBodies(match, markers)` records which of a caller's
markers each script body contained, rather than the bodies themselves. Matching on content rather
than URL is what makes it work unchanged on both hosts, where the same edit arrives as a module on
one and inside a reloaded bundle on the other.

Measured 0 failures in 10 under the CPU contention that produced 2 in 10 before.
