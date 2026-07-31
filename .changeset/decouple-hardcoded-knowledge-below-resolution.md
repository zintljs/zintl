---
"@zintljs/compiler": patch
---

Fully decoupled the remaining hardcoded knowledge of assets and HTML projections below the adapter resolution layer. Refactored `CatalogManager` and `GraphManager` to genericize virtual boundary tracking and content checks via resolved content adapter hooks, eliminating direct imports and usage of manager classes in the compiler core.
