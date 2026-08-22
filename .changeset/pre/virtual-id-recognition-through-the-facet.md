---
"@zintljs/compiler": minor
"@zintljs/testing": patch
---

Routed virtual-module **recognition** through the bundler facet, closing the half of that seam that never existed.

`BundlerFacet.resolveVirtualPath` existed to construct virtual ids. Nothing existed to recognise them: core tested `id.startsWith("\0")` — Rollup's convention, hardcoded into a bundler-agnostic layer — at seven sites deciding whether a module was Zintl's own, and therefore whether to normalize it, give it a catalog, or let it become a boundary.

On Rspack that test is false for virtual modules past the `transform` boundary, because unplugin materialises them as real files under `node_modules/.virtual/`. Nothing broke, because an adjacent `id.includes("node_modules")` test happened to be true — correct behaviour resting on another project's choice of directory name, which would have failed silently by extracting strings from Zintl's own generated catalogs the day that directory moved.

`BundlerFacet.isVirtualId` is the counterpart. It uses substring rather than prefix semantics, because boundary ids embed the module id they were minted from; Rspack's implementation recognises both spellings a virtual module has on that host. `IOManager` holds and exposes it, since every other manager already holds an `IOManager` and none hold the system view. With no bundler facet the default stays the `\0` test, so nothing changes for the compiler's own unit tests.

Six of the seven sites moved. The seventh strips a `\0` prefix so a user's SSR entry pattern can match and already tries the unstripped id too — it normalizes rather than asking about ownership, so it stays a byte test with a comment saying why.

**Also fixes a blind spot in the guardrail meant to catch exactly this.** The facet-composition golden files report single-provider hooks from two hand-maintained arrays, and `hmrSelfAcceptCode` had been missing from both since it was added — so a facet-surface change was invisible to the artifact whose purpose is making facet-surface changes visible. Both hooks are listed now, with a note at the arrays.

Adds `tests/fixtures/multiplex-assets.ts`, a multiplexed project with `virtualAssets` and a localized binary asset. It covers `emitFile` and `import.meta.ROLLUP_FILE_URL_*` under multiplex, which had no coverage at all.
