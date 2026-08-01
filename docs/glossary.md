# Glossary

Zintl's codebase uses a fair amount of its own vocabulary. Most of it is precise rather than decorative, but none of it is guessable. This page is the decoder ring — useful for contributors, and for anyone reading a test name and wondering what a Colony is.

## Core concepts

**Trust anchor** — a call to `zintl(locale)`. The point where your app declares what language it's in. Every anchor is independent and owns its own loading lifecycle.

**Boundary** — the set of strings reachable from one trust anchor. Becomes one catalog chunk. The central unit Zintl reasons about.

**Boundary graph** — the dependency graph connecting anchors to the files whose strings they need. Chunking falls out of this.

**Entry point** — a file containing a top-level `zintl()` call, as opposed to one nested inside a function.

**Stitched unit** — the real unit of extraction. Template literals, JSX fragments, and HTML are stitched into logical pieces before extraction, so a sentence split across tags stays one translatable sentence.

**Ghost mode** — the source locale is never written to disk. The compiler virtualizes it from the extraction manifest, since it already has those strings.

**ZCU baking** — compiling ICU grammar rules into plain JavaScript conditionals at build time, so no ICU parser ships to the browser.

**Smart manager** — generated loader code that inlines the anchor's locale for an instant start while keeping other locales lazy.

**Hive** — the translation memory. Lets a translation follow its source string through edits instead of being orphaned by a typo fix.

**Facet** — a composable unit of compiler behaviour covering one concern (a framework, SSR, assets, a bundler). Composed at construction; conflicts are hard errors.

**Multiplex** — building each locale as its own set of HTML entries.

**Settle beacon** — a development-only counter the runtime increments whenever it applies a locale change or catalog. Test harnesses wait on it instead of sleeping.

## Terms in tests and benchmarks

These appear in test filenames and benchmark labels and are otherwise undocumented:

**ZRS** — Zintl Reference Spec. Prefix on specification tests (`zrs-s2-…`, `zrs-s7-…`), numbered by section.

**Colony** — several boundaries loading together, exercised as one unit. "Colony HMR latency" measures a hot update that touches a group of managers rather than one.

**Kingdom** — a boundary group created by an implicit anchor marker, used in symbiosis tests.

**Hammer** — a stress pattern: rapid back-to-back edits testing that the final state wins. See `hmr-hammer.contract.spec.ts`.

**Storm** — the same idea for locale switching: many switches in quick succession.

**Chaos** — deliberately destructive tests. Deleting or corrupting catalogs and asserting the system recovers.

**Phantom boundary** — a boundary extracted from a file not actually reachable from any anchor. A bug class, not a feature.

## Testing vocabulary

**Contract** — a capability-matched test. Declares `requires: Capability[]` and runs against every project claiming those capabilities, rather than naming a specific app.

**Manifest** — describes a project a contract can run against: its capabilities, its adapter, and where the project comes from.

**Project source** — where a manifest's project is materialized from: `exampleSource` (a real app in `examples/`), `copiedExampleSource` (a per-worker copy, which is what makes parallel runs safe), or `fixtureSource` (a project defined inline in the test).

**Lab** — the harness handed to a contract: page, filesystem, console, HMR socket, compiler, and assertions.

**Adapter** — the per-project knowledge a contract needs but shouldn't hard-code: which selector holds the heading, which file to edit, how to switch locale.
