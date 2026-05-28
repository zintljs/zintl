---
"@zintl/compiler": patch
---

Fixed SFC extension normalization in chunk and metadata resolution. Standardized metadata lookup in `getMeta` to resolve `.vue` and `.svelte` files and aligned internal path normalization to only strip JS/TS source extensions (preserving Vue/Svelte extensions), preventing empty catalogs for SFC-level anchors.
