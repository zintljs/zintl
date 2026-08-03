---
"@zintljs/compiler": patch
---

Make boundary ownership deterministic — the same source compiled to two different graphs.

`computeTranslationChunks` assigns ownership by walking each chunk root's static tree and keeping whichever root reached a boundary first. The root set came back from `getChunkRoots` in graph-insertion order, so for any boundary reachable from two roots, **iteration order decided the owner**.

Insertion order is not stable across runs. A compiler starting cold discovers in filesystem-traversal order; one reading a saved manifest gets the manifest's key order, and manifests are written sorted. So whether a previous build had run changed the graph.

It is directly observable in `react-basic`, whose `main.tsx` holds two nested anchors — `bootstrap` and an anonymous arrow function — both of which statically reach `App`. Warm, `src/App.tsx:App` was owned by `src/main.tsx:bootstrap`. Cold, by `src/main.tsx:f_547`. Both compiles were internally consistent; they simply disagreed, and the disagreement propagated into chunk assignment and four committed graph snapshots.

Roots are now sorted lexicographically before ownership is assigned. Cold and warm produce identical graphs, and the committed snapshots — recorded warm — remain correct, because `"bootstrap"` sorts before `"f_547"`.

**ZRS Axiom 4 already required this.** Its rule was stated for circular dependencies while its rationale — "deterministic, reproducible builds regardless of file system enumeration order" — was general, and the general case was where it was being violated. The axiom now says what the code does: wherever ownership is decided by which candidate is reached first, the candidates are ordered lexicographically, never by discovery order. Any first-wins resolution that is not explicitly ordered is an instance of this bug waiting to be found — which is the same rule ZDB Axiom D4 states for facet fan-outs, arrived at from the other direction.

Covered by `zrs-s4-ownership-determinism`, which feeds the same two roots in both orders and requires one answer. Both of its cases fail without the sort.
