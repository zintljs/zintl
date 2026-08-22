---
"@zintljs/testing": patch
---

Promoted the Rsbuild project from a test fixture to a real example at `examples/rsbuild-spa`.

It began as proposal 026's falsification harness, deliberately living outside `examples/` so it carried none of that directory's obligations. It now has them: it builds under `vpr build:examples`, satisfies lint and knip, and is something a user is invited to copy. Its manifest reads the app through `copiedExampleSource` like every other example, which leaves `dirSource` without a caller — kept, because it is the general "checked-in directory outside `examples/`" source and this removes its only user, not its reason to exist.

**The gaps are stated in the app itself**, in a rewritten README: no hot updates, no `<html dir>`, no `<title>`/`<meta>` translation, no SSR or MPA. A production-build-only example is still a real example; a `dev` script that starts a server and silently never updates would not be, which is the failure mode the honesty is aimed at.

**A guardrail was about to vouch for a fiction.** The facet-composition golden files enumerate `examples/` from disk but hardcoded `bundler: "vite"`, including in the invariant asserting that every example resolves exactly one bundler facet. After promotion that would have kept passing — by describing an Rsbuild app as resolving `viteFacet` and asserting the description was right. What it would have been vouching for is the defect where Vite-specific syntax is emitted into Rspack output. The bundler is now derived per example from the config on disk, and the invariant asserts the host's own facet rather than a constant.

Two smaller corrections came with it: the hand-written `*?raw` type shim is gone in favour of `types: ["@rsbuild/core/types"]`, which Rsbuild ships and which mirrors how the Vite examples use `vite/client`; and `@rsbuild/core` is no longer a root devDependency or a knip exception, since the app declares its own.
