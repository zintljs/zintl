---
"@zintljs/testing": patch
---

The Rsbuild dev-server driver now asks the OS for a free port instead of letting every project start from Rsbuild's default (ledger L-036).

`createLabDevServer` defaults to `port: 0`. Vite reads that as "pick an ephemeral port", which cannot collide; Rsbuild would serve on literal port `0`, so the driver passed `undefined` and every Rsbuild project began at 3000 and auto-incremented. With one Rsbuild example that was invisible — with two on separate workers it is a race, and the loser dies with `EADDRINUSE` while its contract waits out the full 45s timeout, on whichever contract happened to be running.
