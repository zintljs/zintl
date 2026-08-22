---
"@zintljs/compiler": patch
---

Fixed the translation-neutrality walk skipping dependencies imported without a file extension.

`GraphManager.hasTranslatableContent` decides whether a module needs a per-locale copy during multiplex propagation. It resolved a relative dependency by path-joining alone, so `./counter` became `src/counter` — a key in no graph — and the walk stopped there, reporting the importer as having nothing to translate. It now resolves through `resolveDependencyFileId`, which tries each known source extension, as every other traversal in that file already did.

The failure direction is why this matters: "neutral" means _needs no per-locale copy_, so a false positive silently drops a module's translations, where a false negative only costs a redundant copy.

A second defect surfaced while testing it and is now closed: `resolveDependencyFileId` resolved against the manager's last-built graph state while its caller was handed graphs as arguments, so the two could disagree about which files exist. The graphs are now overridable parameters.

Resolution deliberately keeps **exact** key lookups. Also matching the manifest's `<file>:<boundary>` prefix during resolution looked correct but cost a `Object.keys` scan per candidate, per extension, per dependency edge, and blew the Structural and Colony HMR budgets by 48% and 23% on an idle machine. It bought nothing: a file with manifest entries is keyed in the metadata and dependency graphs too, and both are exact. Content discovery still prefix-matches, once per node rather than once per candidate.

No output changes: the predicate short-circuits as soon as the importing module itself has content, so a dependency's resolution only decides the answer for an inert module whose sole translatable content sits behind an extensionless import in a multiplexed project. Adds the first unit coverage this predicate has had.
