---
"@zintljs/compiler": patch
---

Decoupled static asset localization (`AssetManager`) and HTML catalog/schema projection (`HtmlManager`) from the hardcoded execution paths of the compiler. Created the generic `ContentAdapter` interface and a stable `CompilerContext` API, migrating the manager behaviors into pluggable system content adapters (`staticAssetsAdapter` and `htmlProjectionAdapter`).
