---
"@zintljs/compiler": minor
"zintl": minor
---

Consolidated the facet configuration and instantiation pattern. Replaced static facet objects and custom creation helpers with standardized function factories named `nameFacet(options?)` (e.g., `vanillaFacet()`, `assetsFacet()`, `viteFacet()`). Introduced compound facet factories (e.g., `reactFacet()`, `vueFacet()`, `htmlFacet()`, `nextjsFacet()`, and `ssrFacet()`) to return a flattened list of concerns under a single configuration entry. Relocated all preset automation and auto-resolution logic from the compiler core to the Vite plugin, making the compiler entirely logicless. Finally, renamed `ZintlOptions` to `CompilerOptions`, and re-exported all facet factories directly from the `zintl` plugin package so users do not need to install the compiler package to customize facets.
