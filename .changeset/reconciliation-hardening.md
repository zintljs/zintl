---
"@zintljs/compiler": minor
---

Hardened catalog reconciliation — the subsystem that decides, when source text changes, whether a translation is carried forward or dropped. Because keys derive from the text itself, this is what makes ordinary copy edits safe, and it had three unit tests.

**Its two failure modes are not symmetric, and the design now says so.** A _missed_ rename is cushioned: the translation hive is append-only and keyed by source text globally, so the old translation is never destroyed and `CatalogManager` restores it if that text reappears. A _wrong_ rename is not cushioned — the old translation is written under the new source text and then memorized into the hive, so one bad match propagates. Everything below follows from that asymmetry.

**Carry-forwards are now reported.** `ReconcileResult` gains a `renamed` array recording every rename with its similarity score and a `substitutesWords` flag, and `MessageManager` surfaces them: a warning when a whole word was swapped, debug otherwise. Deletes stay quiet, because the hive already covers them.

The flag is a risk signal, never a rejection. Edit distance cannot separate `"Enable notifications"` from `"Disable notifications"` — they are ~0.86 similar — and no threshold can, since a negation and a spelling fix are the same edit size. But a negation _substitutes a word_ while a typo fix, a punctuation change or an appended clause does not, so that shape is worth a developer's eyes. A single-word spelling fix (`"Colour"` → `"Color"`) trips it too; it still reconciles, it is just visible.

**Matching is deterministic.** Renames were assigned by walking removed texts in manifest order and taking each one's best available partner. When two removed strings competed for the same partner, iteration order decided which kept its translations. Candidate pairs are now scored globally and assigned best-first, with ties broken on text, so the outcome is a pure function of manifest _content_ rather than ordering — and the greedy result is strictly better matched.

**Short strings no longer fall off a cliff.** Similarity is length-relative, so `"OK"` → `"Ok"` was one edit over two characters — 0.5, under the 0.6 threshold — and a casing fix on a two-letter button was classified as a delete. The new `isRenameCandidate` applies a one-edit floor. This only ever relaxes the budget, and only where the ratio rounded below a single edit, so nothing three characters or longer changes behavior.

**Separated two thresholds that had been conflated.** The assets facet's fuzzy matching now uses its own `DEFAULT_ASSET_DRIFT_THRESHOLD` rather than borrowing `DEFAULT_RENAME_THRESHOLD`. One asks "is this the same UI string, edited?" over short labels; the other asks "did this document change materially?" over whole file bodies. They share a value today and are now free to diverge.

**Tests went from 3 to 26**, and are grouped around the asymmetry: the short-string budget, word-substitution reporting, and a property block covering classification exhaustiveness (every removed text lands in exactly one of rename/move/delete), invariance under manifest and boundary ordering, one-partner-per-text, closest-partner preference, no-op on unchanged manifests, and similarity symmetry.
