---
"@zintljs/compiler": minor
"zintljs": minor
---

Vue components written with the Options API now work, on Vite and on Rsbuild alike.

A plain `<script>` component compiles its template into a separate render function whose expressions
resolve against the component instance — so the `_t` and manager bindings Zintl injected into the
script block were not in scope, and the page rendered empty with `_ctx._t is not a function`. The
build was green, the catalogs were correct, and only the browser could tell. Every Vue example in this
repository used `<script setup>`, which is why it went unseen (ledger L-053).

Zintl now authors the `<script setup>` block the component lacks, beside the one you wrote rather
than instead of it. Vue compiles the two together — the added block's imports are hoisted to module
scope and your `export default { data, methods }` remains the options object — so nothing about your
component changes, and its `lang` is mirrored exactly, because Vue rejects two script blocks whose
languages disagree.

Three shapes cannot take the extra block, and now fail the build with a message naming the reason
instead of rendering an empty page: a `<script src="…">`, a `<script lang>` that is not JavaScript or
TypeScript, and a component that already declares its own `setup` option (Vue would silently replace
it). The refusal is deliberately narrow — it fires only when a _template_ string needs an injected
binding, so a component whose strings live in its script block, and any baked (`zintl("fr")`) build,
are untouched.

Where this lands in the facet contract: `CodegenFacet.requiresScriptSetup` is how a dialect declares
that its templates resolve against the component instance. Vue declares it; Svelte does not, because
its `<script>` is the component scope. `wrapSfcScript` gains an optional `{ lang }` so an authored
block can match one that already exists. The compiler core learns nothing about Vue — it asks the
facet.

`examples/vue-basic` and `examples/rsbuild-vue-basic` each gained an Options-API component, verified
in a real browser in all four locales in dev and in a production preview.
