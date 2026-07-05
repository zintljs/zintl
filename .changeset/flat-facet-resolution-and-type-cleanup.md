---
"@zintl/compiler": minor
"zintl": minor
---

Refactored the compiler extension model from Adapters to Facets, formalizing the Concern-Faceted Compiler Architecture and Dimension-Constrained composition system. Renamed `ZintlAdapter` to `ZintlFacet`, `resolveAdapters` to `resolveFacets`, and the `adapters` configuration options to `facets` across the compiler, plugin, examples, and tests.
