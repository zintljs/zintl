# Specifications & design notes

These are internal engineering documents, not user documentation. If you're using Zintl, start with the [docs index](../README.md) instead.

They're kept in the repository because the reasoning behind a decision is the most expensive thing to reconstruct later — code shows _what_, and only these show _why_.

## Specifications

| Document                         | Covers                                                               | Status |
| :------------------------------- | :------------------------------------------------------------------- | :----- |
| [SPEC.md](SPEC.md)               | System overview and design principles                                | Active |
| [ZRS.md](ZRS.md)                 | **Reference specification** — entities, anchors, boundary resolution | Active |
| [ZCD.md](ZCD.md)                 | Comment directives (`@zintl-ignore`, `@zintl-note`, `@zintl-pass`)   | Active |
| [ZHMR.md](ZHMR.md)               | Hot module replacement behaviour                                     | Active |
| [ZDB.md](ZDB.md)                 | **Delivery bus** — update ordering, custody, failure outcomes        | Draft  |
| [ZCU.md](ZCU.md)                 | ICU handling and compilation                                         | Draft  |
| [PERFORMANCE.md](PERFORMANCE.md) | Performance budgets and what they protect                            | Active |

**ZRS.md is the one to read first.** It's also directly referenced by the test suite: files named `zrs-s2-anchor-hierarchy`, `zrs-s4-handshake-axioms`, `zrs-s7-handshake-ledger` and so on assert the behaviour of the correspondingly numbered sections. If you change behaviour ZRS describes, the spec and its tests should move together.

ZDB.md is the newest and the one with the widest reach: it governs ordering and failure outcomes wherever a change is delivered, which is the runtime, the hot-update path, the compiler pipeline and disk writes. Its §6 **replaces** ZRS §9.1 — read them in that order, since ZRS's original failure model described a fallback and a retry that never existed in the code.

## Backlog & proposals

- [`backlog/`](backlog) — 17 numbered work items, largely historical. They record what a change was meant to achieve and what it replaced. `005-deprecating-dataflow-tracing.md` and `004-commit-to-intelligent-stitching.md` explain why extraction works the way it does today.
- [`proposals/`](proposals) — 19 design explorations, at varying stages. Not all were adopted. [`026-rsbuild-as-falsification-harness.md`](proposals/026-rsbuild-as-falsification-harness.md) is the odd one out: a **method** proposal rather than a design, describing how to use a second build tool to find the Vite-shaped assumptions the facet layer never reached. Read it before freezing the facet authoring contract. It is **complete**: §11 records the outcome, and [`026-leak-ledger.md`](proposals/026-leak-ledger.md) holds nineteen findings, one entry per assumption, with the verdict reached and why. Read §11 before deciding anything about a second bundler — it answers the four open questions and says plainly what Rsbuild support would still cost. [`027-completing-the-rsbuild-target.md`](proposals/027-completing-the-rsbuild-target.md) picks up that remaining work and the decision 026 declined to take: promoting Rsbuild into `examples/`.

Both directories are archives as much as plans. A document describing an approach that was later replaced is still worth keeping — knowing which paths were tried and rejected saves the next person from retrying them.

## Reading these safely

Treat a `Status` line as the author's last assessment, not a guarantee. Where a document and the code disagree, **the code and its tests are authoritative** — and the disagreement is worth an issue, since it means one of the two drifted.

Documents in `backlog/` and `proposals/` describe intent at a point in time. Some describe systems that were built differently or not at all; `007-zintl-rebrand.md` deliberately preserves the old `@zintl/*` package names because documenting the rename is its entire purpose.
