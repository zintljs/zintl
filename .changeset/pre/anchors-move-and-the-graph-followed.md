---
"@zintljs/compiler": patch
---

A boundary whose anchor has moved no longer re-enters the graph from the persisted manifest.

Nested anchors are named for where they sit — `f_<offset>`, the offset of the `zintl()` call inside its
script block — so editing anything _above_ the call renames the boundary. The old name survives in
`.zintl`'s manifest as an empty key, and boundary-graph construction seeded its candidates from that
manifest's keys, so the dead name came back as a node. The skip-empty guard could not stop it: that
guard reads the **file's** dependencies, and the file still imports `zintljs/macro`, so a dead boundary
inherited the pass-through rule written for intermediate modules.

The graph therefore depended on when the machine last built. Adding a doc comment above `<script setup>`
in the shared locale bar moved one anchor from 700 to 846 and left six ghost nodes in committed graph
snapshots — invisible on any checkout whose manifest predated the edit, and red on CI, which builds one
from `HEAD`.

`buildBoundaryGraph` now requires the current extraction to attest a nested boundary before seeding it.
Metadata is rewritten per file as that file is read, so it describes the source as it is; the manifest
beside it does not. An unattested key that still carries strings is kept — a partial rebuild re-extracts
one file and attests nothing about the rest, and dropping such a key would drop real translations — so
only dead, empty names are refused.

This is [L-055](https://github.com/zintljs/zintl/blob/main/docs/spec/proposals/027-leak-ledger.md)'s fix
carried past virtual boundaries, which is where it stopped. See ledger L-082.
