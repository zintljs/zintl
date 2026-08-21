---
"@zintljs/compiler": minor
"@zintljs/extractor": minor
"zintljs": minor
"@zintljs/testing": patch
---

Add Preact, Solid and Lit — the three frameworks `create-vite` and `create-rsbuild`
scaffold that Zintl did not support.

Zintl's claim has been that another framework is additive work rather than a core rewrite. That was
untested against anything the project did not write itself: of the eight templates `create-vite`
scaffolds, four had no support at all. Three of them do now, on both hosts.

**Preact** is the claim holding up. Its extraction is React's — both read one shared `JSX_TARGETS`
list, because JSX is JSX — and it differs in exactly two declarations. The subscription hook comes
from `preact/compat`, not `preact/hooks`. And re-running the entry is _safe_ here where it is not in
React: `createRoot` mounts a second root over a container it already owns, while Preact's `render()`
diffs against the tree already there. Measured before it was declared — seven consecutive entry
edits, one `#center` throughout, with a `window` marker surviving to rule out a page reload.

**Solid** is the claim being stretched, and it found a real defect. A Solid component runs once; its
JSX compiles to fine-grained effects, so subscribing it has nothing to act on. It uses the
`reactiveBridge` seam Vue already had, mirroring the store into a signal whose read is spliced into
every `_t` call — so rendering a translation _is_ taking the dependency, and no sink can be missed.
The observable result is the nicest in the suite: switching locale remounts nothing, and a counter
keeps its value across two switches where every other framework example throws it away.

The defect it exposed: the compiler injected `useSyncExternalStore(...)` into any file with component
functions, gated only on server components. Vue and Svelte escaped because their SFCs have no
component functions to find — a property of their file format, not a decision — so the first JSX
dialect _without_ a hook got a call to an undefined name. The injection is now gated on the framework
having declared a hook to call, which is what the condition should always have been.

**Lit** needed capability rather than configuration, and each addition is framework-blind:

- `` tag:`<name>` `` in the extractor — "the contents of a template literal tagged with this
  identifier are markup". Lit's markup is neither a file format nor JSX but a tagged template inside
  an ordinary module, and neither existing seam reached it: an `sfcRules` entry for `.ts` would
  hijack every module in the project or leave the code around the template unextracted, taking the
  `zintl()` anchor with it. htm and uhtml get this from the same declaration.
- `CodegenFacet.codegenImports` — what a dialect's _generated_ markup references. React's
  `dangerouslySetInnerHTML` and Svelte's `{@html}` are syntax; Lit's `unsafeHTML` is an import.
- `CodegenFacet.wrapTemplateFragment` — how a `_t` call is interpolated into a surrounding template
  literal. `${…}` was hardcoded, which is right for a vanilla `innerHTML` template and wrong for Lit,
  where an interpolated string is deliberately rendered as text.

Lit's limits are declared rather than papered over: `repaintsOnCatalogUpdate` is left undeclared,
because repainting a live element needs a registry of connected components — a mixin, which is
application code — and `lit-basic` claims no `hmr` capability as a result.

Coverage is a real example app per framework on Vite plus an inline Rsbuild fixture, following
`tests/manifests/index.ts`'s own guidance that cost is roughly (projects × matching contracts). The
contract suite goes from 309 to 371.

Detection prefers Preact over React and resolves it after both scans, because `@preact/preset-vite`
aliases `react` — a project resolving as both would activate two codegen facets claiming `.tsx`,
which is a hard error by design. Solid is matched on separator boundaries so `splitVendorChunk` is
not read as a framework, and Lit is detected from dependencies only, since it has no plugin on either
host.

Qwik remains unsupported: it is Vite-only, and resumability against a module-level reactive store is
a question about the runtime rather than a facet.
