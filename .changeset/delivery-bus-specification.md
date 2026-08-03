---
"@zintljs/compiler": minor
---

Add the delivery bus — a governance discipline for ordered, repeatable work.

Zintl does the same shape of work in four places: something changes, a procedure runs, and a result is delivered elsewhere. A file changes and a packet is emitted. A catalog arrives and a store applies it. A flush is requested and disk is written. A facet is asked and contributes. Every one of those is repetitive, concurrent, and capable of conflicting with itself — and none of them had a name for **what** was being delivered, **in what order**, or **whether it landed**.

The measured consequences: a later update losing to an earlier one, a boundary rendering blank permanently with nothing recorded, a flush silently discarding the boundaries a second flush had dirtied, and outputs surviving on disk after the source that produced them was gone.

This is not a message queue and not a transport. It is five absolute axioms plus the smallest data structure that enforces them, specified in `docs/spec/ZDB.md` and promoted alongside ZRS/ZHMR/ZCD:

- **D1 Monotonic Supersession** — a receiver discards anything not newer than what it applied. Latest wins _by number_, never by arrival time and never by a debounce window.
- **D2 No Silent Abandonment** — every envelope reaches `applied`, `superseded` or `failed`. Coalescing is a named outcome, not a disappearance.
- **D3 Causal Custody** — a stage that coalesces inherits the superseded envelope's subjects, so no subject is left without a custodian.
- **D4 One Subject, One Owner** — competing contributors resolve by declared rank; a tie is a hard error at construction.
- **D5 Cost Asymmetry** — identity and sequence ship; the ledger and every reason string are development-only and eliminated at build time.

`DeliveryBus` is exported from `@zintljs/compiler`, with `mint`/`accept`/`holds` as the ordering machinery and a bounded ring for diagnosis. Recording is off by default, so a caller who forgets gets the cheap bus: the failure mode is "no diagnosis available", never "diagnostic machinery left on". The ring is bounded normatively rather than as an optimisation — `memory-leak` measures retained heap across twenty consecutive hot updates with only a few hundred kilobytes of headroom.

Two documents were reconciled against the code on the way in. Proposal 024 is marked ABSORBED, with the three things it got wrong called out. **ZRS §9.1 is superseded**: it promised a source-locale fallback and exponential-backoff retry, neither of which was ever implemented, and the first of which is forbidden outright — a missing translation is a build-time error, not a reason to render a different language. The original text is preserved rather than deleted, because knowing which model was intended and rejected is worth more than a silent removal.
