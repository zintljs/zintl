---
"@zintljs/compiler": minor
---

Report per-locale translation completeness on every dev flush.

`ar 44/47 · fr 12/47`, printed when it changes and only when it changes.

The gate already tells you, in full, and refuses the build. That is correct and it is also _late_:
the first a team hears of a missing translation should not be CI going red on a Friday afternoon.
Between "nobody has mentioned this" and "the release is blocked" there was nothing.

Two decisions worth stating, because both could reasonably have gone the other way.

**Counted against the hive, not by re-reading catalogs.** The hive is what `verifyIntegrity` already
accepts — a key it can satisfy is a key that passes the gate — so the number cannot disagree with
whether the build will succeed. A status that read "complete" while the build failed would be worse
than no status. It is also pure in-memory set arithmetic, where re-reading every catalog for every
locale on every dev flush would not be.

**Serving only.** A build either passes at 100% or fails with the list, so a build-time summary could
only ever say "everything is translated". Dev is where the number is both true and interesting.

**Incomplete logs at `warn`, complete at `info`** — severity tracking consequence rather than tone.
An incomplete locale is not a status update, it is a build that is going to fail. At `info` it would
be the first line to vanish for anyone running `logLevel: "warn"`, a common choice in CI, who would
keep every line they did not care about and lose the one that predicts the failure. The warning says
what it will cost, because that is the justification for the level.

An empty string counts as untranslated, matching the gate. The source locale is left out entirely —
never written to disk, translated by definition, and a permanent `0/N` would mean nothing.

`getTranslationStatus()` is public, so a facet or a host integration can ask for the same counts
without going through the log.

**Debounced, and that is a measurement rather than a preference.** Computed inline on the flush,
counting every manifest key against every locale pushed `Colony HMR Latency (Manager Sync)` from
inside its budget to 3.2x calibration against a 1.6x budget — cheap in isolation, not cheap on the
HMR hot path. `vpr bench` caught it; re-running the benchmark with the call removed confirmed the
cause was the call and not the machine. Nothing needs this number synchronously, so it waits for the
edits to stop, which also means one line per burst instead of one per keystroke.

Pending locales — the case where this number would have content at build time as well — are designed
and deliberately deferred past the first beta. See
[proposal 031](/docs/spec/proposals/031-pending-locales.md), which also records why they are _not_ an
answer to a red build on a Friday, and what is: an explicit, temporary `verifyIntegrity: false`, now
documented in `docs/configuration.md`.
