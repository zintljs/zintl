---
"@zintljs/compiler": patch
"zintljs": patch
---

Bypassed code transformations and catalog generation/pruning for non-zintlized files and projects:

- **Bypass Transformations for Non-Zintlized Projects**: Updated the compiler transform pipeline to check for the presence of Zintl entry points/anchors in the project, completely skipping AST transforms and manager injection for projects with zero active entry points (like the `vanilla-ssr` example).
- **Conditional Vitest Testing Support**: Allowed unit tests checking isolated transforms to continue running in Vitest by identifying test environment file contexts and selectively bypassing the anchor-check.
- **Dynamic Catalog Restriction**: Updated the catalog manager to skip syncing and pruning boundary catalogs when zero active entry points exist.
- **Test Coverage**: Added dedicated unit test coverage verifying that non-zintlized source files with UI sinks remain untransformed when no Zintl entry points are present.
