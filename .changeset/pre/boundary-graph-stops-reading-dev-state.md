---
"@zintljs/compiler": patch
---

A production build no longer inherits a dev-only virtual boundary from its own persisted metadata.

`b_assets` — the boundary that carries localized assets — is synthesized in dev only. But the dev
synthesis is written into `.zintl`'s manifest, and boundary-graph construction seeded its candidates
from that manifest's keys, so a build that happened to read a dev-written manifest grew a `b_assets`
node through the ordinary node path. Two builds of identical source could therefore produce different
boundary graphs, decided by whether a dev run had touched the project first.

`buildBoundaryGraph` now skips virtual boundaries when seeding candidates outside dev, so the graph is
a function of the source rather than of what ran before it. Dev is unchanged and still synthesizes the
node with its own distinct shape. See ledger L-055.
