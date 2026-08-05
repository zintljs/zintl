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

## Its snapshots record a known bug on purpose

`src/about.txt` and its localized copies under `src/i18n/src/` reproduce **ledger
L-009**, and the committed build snapshot is the evidence.

Rspack types modules by file extension, so it classifies `.txt` as an asset and
base64-encodes the JavaScript Zintl generated for it into a `data:` URI. The
catalog then holds that URI instead of the translated text, and the page renders
`data:text/plain;base64,…` where Arabic should be. **The build succeeds and every
contract passes** — it is a silent wrong answer, not a failure.

So `__snapshots__/rsbuild-spa/dist-output/static/js/async/0.js.snap` contains a
`data:` URI, deliberately. Do not "fix" the snapshot. It is the tripwire: whoever
makes it stop containing a data URI has fixed L-009, and the diff is how they
will know.
