# `rsbuild-spa` — proposal 026 falsification target

Not an example, and not a supported configuration. This is the second host the
contract layer can drive, so that "the compiler is bundler-agnostic" has
something capable of disagreeing with it. See
[`docs/spec/proposals/026-rsbuild-as-falsification-harness.md`](../../../docs/spec/proposals/026-rsbuild-as-falsification-harness.md)
and the [leak ledger](../../../docs/spec/proposals/026-leak-ledger.md).

It deliberately lives here rather than under `examples/`: anything in `examples/`
joins `vpr build:examples`, lint, knip and CI, which is a maintenance commitment
this spike has not earned. It is reached by `dirSource()` and copied per worker
like any other project.

Scope is ZDB §7a **Tier 1** — build only. Its manifest claims `build`, `graph`
and `transform` and nothing else, so the 17 dev-server contracts never select it.

It mirrors `examples/vanilla-spa-basic` as closely as the host allows, minus the
binary asset imports.

## What the asset files are for

`src/about.txt` and its localized copies under `src/i18n/src/` exercise asset
localisation, which is where **ledger L-009** was found: Rspack types modules by
file extension, so it classified `.txt` as an asset and base64-encoded the
JavaScript Zintl generated for it into a `data:` URI. The catalog shipped a URI
where the translated text belonged, with a green build and green contracts.

That is fixed — raw text assets now resolve to an extension-free virtual id — and
the snapshots are the regression guard. If a `data:text/plain` string ever
reappears in `__snapshots__/rsbuild-spa/dist-output/`, L-009 is back.
