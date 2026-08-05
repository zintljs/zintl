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
`?raw` and binary asset imports. That omission is deliberate rather than
incidental: asset localisation depends on `emitFile` returning a reference id,
which Rspack does not do (ledger L-005), so including assets here would mix a
known-open leak into every unrelated trace.
